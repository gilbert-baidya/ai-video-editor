import { assertProjectId } from './product-store.ts';

const projectActions = new Set(['status', 'qa', 'source', 'output', 'review-workspace', 'ingest', 'transcribe', 'analyze', 'director', 'review', 'render', 'assets']);

export function parseProjectApiRoute(pathname: string): { projectId: string; action?: string } | undefined {
  const match = pathname.match(/^\/api\/projects\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return undefined;
  assertProjectId(match[1]);
  if (match[2] && !projectActions.has(match[2])) return undefined;
  return { projectId: match[1], action: match[2] };
}
