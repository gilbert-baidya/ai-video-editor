import type { ReviewDataPayload } from './DirectorReviewWorkspace.tsx';
import type { ReviewState } from './director-review.ts';
import type { CreateProjectRequest, ProductCapabilities, ProductJob, ProductProjectRecord } from './product-api.ts';
import type { ProductStage } from './product-workflow.ts';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Product API returned HTTP ${response.status}.`);
  return body;
}

export const productClient = {
  capabilities: () => request<ProductCapabilities>('/api/capabilities'),
  listProjects: async () => (await request<{ projects: ProductProjectRecord[] }>('/api/projects')).projects,
  getProject: async (projectId: string) => (await request<{ project: ProductProjectRecord }>(`/api/projects/${projectId}`)).project,
  createProject: async (input: CreateProjectRequest) => (await request<{ project: ProductProjectRecord }>('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })).project,
  upload(projectId: string, file: File, onProgress: (progress: number) => void): Promise<ProductProjectRecord> {
    return new Promise((done, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', `/api/projects/${projectId}/source`);
      xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
      xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      };
      xhr.onerror = () => reject(new Error('The source upload failed because the local host connection was lost.'));
      xhr.onabort = () => reject(new Error('The source upload was cancelled.'));
      xhr.onload = () => {
        const value = JSON.parse(xhr.responseText || '{}') as { project?: ProductProjectRecord; error?: string };
        if (xhr.status >= 200 && xhr.status < 300 && value.project) done(value.project);
        else reject(new Error(value.error ?? `Upload returned HTTP ${xhr.status}.`));
      };
      xhr.send(file);
    });
  },
  startStage: async (projectId: string, stage: ProductStage) => {
    const action = stage === 'transcript' ? 'transcribe' : stage === 'director' ? 'analyze' : stage;
    return (await request<{ job: ProductJob }>(`/api/projects/${projectId}/${action}`, { method: 'POST' })).job;
  },
  reviewWorkspace: (projectId: string) => request<ReviewDataPayload>(`/api/projects/${projectId}/review-workspace`),
  saveReview: async (projectId: string, review: ReviewState) =>
    (await request<{ project: ProductProjectRecord }>(`/api/projects/${projectId}/review`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ review }),
    })).project,
};
