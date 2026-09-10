import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import type { ProductProjectRecord, ProductJob } from './product-api.ts';
import { productStages, recoverProductProject } from './product-workflow.ts';

const projectIdPattern = /^[a-z0-9][a-z0-9-]{2,63}$/;

export function assertProjectId(projectId: string): void {
  if (!projectIdPattern.test(projectId)) throw new Error('Invalid project ID.');
}

export function sanitizeFileName(input: string): string {
  const decoded = decodeURIComponent(input);
  const name = basename(decoded).normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[/:\\]/g, '-').trim();
  if (!name || name === '.' || name === '..') throw new Error('Invalid source filename.');
  return name.slice(0, 180);
}

export function assertWithinRoot(root: string, candidate: string): string {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const child = relative(resolvedRoot, resolvedCandidate);
  if (child === '..' || child.startsWith(`..${sep}`) || resolve(resolvedRoot, child) !== resolvedCandidate) {
    throw new Error('Path escapes the application-managed runtime root.');
  }
  return resolvedCandidate;
}

function validateRecord(value: unknown): ProductProjectRecord {
  if (!value || typeof value !== 'object') throw new Error('Project metadata must be an object.');
  const record = value as Partial<ProductProjectRecord>;
  const workflow = record.workflow ? recoverProductProject(record.workflow) : undefined;
  if (record.schemaVersion !== '1.3' || !workflow) {
    throw new Error('Project metadata has an unsupported or corrupt schema.');
  }
  assertProjectId(workflow.projectId);
  if (!record.artifacts || !Array.isArray(record.jobs) || !record.cacheReuse) throw new Error('Project metadata is incomplete.');
  return { ...record, workflow } as ProductProjectRecord;
}

export class ProductProjectStore {
  constructor(readonly root: string) {}

  projectDirectory(projectId: string): string {
    assertProjectId(projectId);
    return assertWithinRoot(this.root, resolve(this.root, projectId));
  }

  sourceDirectory(projectId: string): string {
    return resolve(this.projectDirectory(projectId), 'source');
  }

  artifactDirectory(projectId: string): string {
    return resolve(this.projectDirectory(projectId), 'artifacts');
  }

  outputDirectory(projectId: string): string {
    return resolve(this.projectDirectory(projectId), 'output');
  }

  cacheDirectory(projectId: string): string {
    return resolve(this.projectDirectory(projectId), 'cache');
  }

  private metadataPath(projectId: string): string {
    return resolve(this.projectDirectory(projectId), 'project.json');
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  async create(record: ProductProjectRecord): Promise<ProductProjectRecord> {
    const valid = validateRecord(record);
    const directory = this.projectDirectory(valid.workflow.projectId);
    const exists = await stat(directory).then(() => true, (error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? false : Promise.reject(error));
    if (exists) throw new Error(`Project already exists: ${valid.workflow.projectId}`);
    await Promise.all([
      mkdir(this.sourceDirectory(valid.workflow.projectId), { recursive: true }),
      mkdir(this.artifactDirectory(valid.workflow.projectId), { recursive: true }),
      mkdir(this.outputDirectory(valid.workflow.projectId), { recursive: true }),
      mkdir(this.cacheDirectory(valid.workflow.projectId), { recursive: true }),
    ]);
    return this.save(valid);
  }

  async save(record: ProductProjectRecord): Promise<ProductProjectRecord> {
    const valid = validateRecord(record);
    const path = this.metadataPath(valid.workflow.projectId);
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(valid, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, path);
    return valid;
  }

  async get(projectId: string): Promise<ProductProjectRecord> {
    assertProjectId(projectId);
    try {
      return validateRecord(JSON.parse(await readFile(this.metadataPath(projectId), 'utf8')) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Project not found: ${projectId}`);
      throw error;
    }
  }

  async list(): Promise<ProductProjectRecord[]> {
    await this.initialize();
    const entries = await readdir(this.root, { withFileTypes: true });
    const records: ProductProjectRecord[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !projectIdPattern.test(entry.name)) continue;
      records.push(await this.get(entry.name));
    }
    return records.sort((left, right) => right.workflow.updatedAt.localeCompare(left.workflow.updatedAt));
  }

  async addJob(projectId: string, job: ProductJob): Promise<ProductProjectRecord> {
    const record = await this.get(projectId);
    return this.save({ ...record, jobs: [...record.jobs, job] });
  }

  async updateJob(projectId: string, jobId: string, update: Partial<ProductJob>): Promise<ProductProjectRecord> {
    const record = await this.get(projectId);
    const index = record.jobs.findIndex((job) => job.jobId === jobId);
    if (index < 0) throw new Error(`Job not found: ${jobId}`);
    const jobs = [...record.jobs];
    jobs[index] = { ...jobs[index], ...update, jobId, projectId, updatedAt: new Date().toISOString() };
    return this.save({ ...record, jobs });
  }

  async recoverInterruptedJobs(): Promise<void> {
    for (const record of await this.list()) {
      let changed = false;
      const jobs = record.jobs.map((job) => {
        if (job.status !== 'running' && job.status !== 'queued') return job;
        changed = true;
        return { ...job, status: 'interrupted' as const, error: 'The host stopped before this job completed.', completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      });
      if (changed) await this.save({ ...record, jobs });
    }
  }

  static stagesAreValid(record: ProductProjectRecord): boolean {
    return productStages.every((stage) => Boolean(record.workflow.stages[stage]));
  }
}
