import { resolve } from 'path';
import { ProductProjectStore } from '../src/product-store.js';
import { renderBlockers } from '../src/product-workflow.js';
async function run() {
  const store = new ProductProjectStore(resolve(process.cwd(), '.runtime', 'projects'));
  const record = await store.get('project-1e2e45fb-e6bc-453e-8071-13ca7c00ff05');
  console.log('Blockers:', renderBlockers(record.workflow));
  console.log('Status:', record.workflow.status);
}
run();
