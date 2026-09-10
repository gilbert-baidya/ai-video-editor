import { readFileSync, writeFileSync } from 'fs';
let content = readFileSync('scripts/test-broll-realization-v1-3-4.ts', 'utf8');

const oldRenderMock = `  const orchestrator = new ProductOrchestrator(store, appRoot, { 
    render: {
      async render() { return true; },
      async checkAvailability() { return { available: true }; }
    }
  });`;

const newRenderMock = `  const orchestrator = new ProductOrchestrator(store, appRoot, { 
    render: async () => ({
      status: 'PASS',
      durationSeconds: 60,
      failures: [],
      editorial: {
        planHash: 'hash',
        workspaceCompatibility: 'compatible',
        realization: {
          schemaVersion: '1.0',
          droppedOperations: [],
          unsupportedOperations: [],
          renderedOperations: ['broll-section-1'],
          durationMatches: true,
          warnings: []
        }
      }
    })
  });`;

content = content.replace(oldRenderMock, newRenderMock);
writeFileSync('scripts/test-broll-realization-v1-3-4.ts', content);
