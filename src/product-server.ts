import { createReadStream } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, resolve } from 'node:path';
import { build } from 'esbuild';
import type { CreateProjectRequest, ProductApiError } from './product-api.ts';
import type { EditPlan } from './contracts.ts';
import type { ReviewState } from './director-review.ts';
import { ProductOrchestrator } from './product-orchestrator.ts';
import { createRemotionRenderAdapter } from './product-renderer.ts';
import { ProductProjectStore, assertWithinRoot } from './product-store.ts';
import { streamUpload } from './source-ingestion.ts';
import { parseProjectApiRoute } from './product-http.ts';

const appRoot = resolve(import.meta.dirname, '..');
const runtimeRoot = resolve(appRoot, '.runtime', 'projects');
const store = new ProductProjectStore(runtimeRoot);
const orchestrator = new ProductOrchestrator(store, appRoot, { render: createRemotionRenderAdapter(appRoot) });
const port = Number(process.env.PRODUCT_PORT ?? 4173);
const host = '127.0.0.1';
let browserBundle = '';

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function bodyJson<T>(request: IncomingMessage, limit = 1_000_000): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  if (!chunks.length) throw new Error('JSON request body is required.');
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

async function streamManagedFile(response: ServerResponse, request: IncomingMessage, path: string): Promise<void> {
  const info = await stat(path);
  const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  const contentType = extname(path) === '.mov' ? 'video/quicktime' : 'video/mp4';
  if (!range) {
    response.writeHead(200, { 'content-type': contentType, 'content-length': info.size, 'accept-ranges': 'bytes' });
    createReadStream(path).pipe(response);
    return;
  }
  const start = range[1] ? Number(range[1]) : 0;
  const end = range[2] ? Number(range[2]) : info.size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= info.size) throw new Error('Invalid byte range.');
  response.writeHead(206, {
    'content-type': contentType,
    'content-length': end - start + 1,
    'content-range': `bytes ${start}-${end}/${info.size}`,
    'accept-ranges': 'bytes',
  });
  createReadStream(path, { start, end }).pipe(response);
}

async function handleApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith('/api/')) return false;
  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { status: 'ok', service: 'ai-video-editor-product-host' });
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/api/capabilities') {
    sendJson(response, 200, await orchestrator.capabilities());
    return true;
  }
  if (url.pathname === '/api/projects') {
    if (request.method === 'GET') sendJson(response, 200, { projects: await store.list() });
    else if (request.method === 'POST') sendJson(response, 201, { project: await orchestrator.createProject(await bodyJson<CreateProjectRequest>(request)) });
    else sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed.' });
    return true;
  }
  const route = parseProjectApiRoute(url.pathname);
  if (!route) {
    sendJson(response, 404, { code: 'NOT_FOUND', error: 'API route not found.' });
    return true;
  }
  const { projectId, action } = route;
  if (request.method === 'GET' && !action) sendJson(response, 200, { project: await store.get(projectId) });
  else if (request.method === 'GET' && action === 'status') {
    const project = await store.get(projectId);
    sendJson(response, 200, { project, jobs: project.jobs });
  } else if (request.method === 'GET' && action === 'qa') {
    const project = await store.get(projectId);
    sendJson(response, 200, { qa: project.qa, output: project.output });
  } else if (request.method === 'GET' && action === 'review-workspace') {
    const project = await store.get(projectId);
    if (!project.artifacts.director) throw new Error('Director workspace is unavailable.');
    const path = assertWithinRoot(store.projectDirectory(projectId), resolve(store.artifactDirectory(projectId), 'review-workspace.json'));
    const workspace = await bodyFromFile<Record<string, unknown>>(path);
    sendJson(response, 200, project.review ? { ...workspace, initialReview: project.review } : workspace);
  } else if (request.method === 'GET' && (action === 'source' || action === 'output')) {
    const project = await store.get(projectId);
    const relativePath = action === 'source' ? project.sourceMetadata?.relativePath : project.artifacts.render;
    if (!relativePath) throw new Error(`${action} artifact is unavailable.`);
    await streamManagedFile(response, request, assertWithinRoot(store.projectDirectory(projectId), resolve(store.projectDirectory(projectId), relativePath)));
  } else if (request.method === 'PUT' && action === 'source') {
    const project = await store.get(projectId);
    if (project.workflow.source.type !== 'local-video') throw new Error('Binary upload is only valid for local-video projects.');
    if (project.sourceMetadata) throw new Error('Project source is immutable and cannot be overwritten.');
    const rawName = request.headers['x-file-name'];
    if (typeof rawName !== 'string') throw new Error('x-file-name header is required.');
    const lengthHeader = request.headers['content-length'];
    const expectedBytes = lengthHeader ? Number(lengthHeader) : undefined;
    if (expectedBytes !== undefined && (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0)) throw new Error('Invalid Content-Length.');
    const metadata = await streamUpload(request, store.sourceDirectory(projectId), rawName, request.headers['content-type'], expectedBytes);
    sendJson(response, 200, { project: await orchestrator.attachUploadedSource(projectId, metadata) });
  } else if (request.method === 'POST' && ['ingest', 'transcribe', 'analyze', 'render', 'qa'].includes(action ?? '')) {
    sendJson(response, 202, { job: await orchestrator.startStage(projectId, action === 'transcribe' ? 'transcript' : action as 'ingest' | 'director' | 'render' | 'qa') });
  } else if (request.method === 'PUT' && action === 'review') {
    const input = await bodyJson<{ review: ReviewState; approvedPlan: EditPlan; ready: boolean; blockers: string[] }>(request);
    if (!Array.isArray(input.blockers) || typeof input.ready !== 'boolean') throw new Error('Review readiness and blockers are required.');
    sendJson(response, 200, { project: await orchestrator.saveReview(projectId, input.review, input.approvedPlan, input.ready, input.blockers) });
  } else sendJson(response, 405, { code: 'METHOD_NOT_ALLOWED', error: 'Method not allowed for this project route.' });
  return true;
}

async function bodyFromFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

const indexHtml = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI Video Editor</title><style>body{margin:0;font-family:Inter,system-ui,sans-serif;background:#0b1013}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`;

async function rebuildBrowser(): Promise<void> {
  const result = await build({
    entryPoints: [resolve(appRoot, 'src/review-entry.tsx')],
    bundle: true,
    write: false,
    outdir: resolve(appRoot, '.runtime', 'browser'),
    platform: 'browser',
    format: 'esm',
    jsx: 'automatic',
    loader: { '.css': 'css' },
  });
  browserBundle = result.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? '';
  const css = result.outputFiles.filter((file) => file.path.endsWith('.css')).map((file) => file.text).join('\n');
  browserBundle = `const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.append(style);\n${browserBundle}`;
}

await orchestrator.initialize();
await rebuildBrowser();

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${host}:${port}`);
    if (await handleApi(request, response, url)) return;
    if (url.pathname === '/app.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      response.end(browserBundle);
      return;
    }
    if (url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(indexHtml);
      return;
    }
    const publicPath = assertWithinRoot(resolve(appRoot, 'public'), resolve(appRoot, 'public', `.${url.pathname}`));
    if (await access(publicPath).then(() => true, () => false)) {
      response.writeHead(200);
      response.end(await readFile(publicPath));
      return;
    }
    response.writeHead(404);
    response.end('Not found');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const missing = message.startsWith('Project not found');
    const conflict = message.includes('already') || message.includes('immutable');
    const payload: ProductApiError = { code: missing ? 'NOT_FOUND' : conflict ? 'CONFLICT' : 'INVALID_REQUEST', error: message };
    sendJson(response, missing ? 404 : conflict ? 409 : 400, payload);
  }
}).listen(port, host, () => {
  console.log(`AI Video Editor: http://${host}:${port}`);
});
