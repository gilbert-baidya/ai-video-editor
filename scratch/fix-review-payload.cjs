const fs = require('fs');

let content = fs.readFileSync('scripts/execute-e2e-v1-3-5.ts', 'utf8');

const importReplacement = `import { ProductProjectStore } from '../src/product-store.ts';
import { sha256Browser } from '../src/sha256.ts';`;
content = content.replace(`import { ProductProjectStore } from '../src/product-store.ts';`, importReplacement);

const payloadReplacement = `  const reviewPayload = {
    schemaVersion: '1.0',
    projectId: projectId,
    sourceEditPlanHash: sha256Browser(JSON.stringify(reviewData.aiPlan)),
    updatedAt: new Date().toISOString(),
    decisions: [`;
    
content = content.replace(`  const reviewPayload = {
    ...reviewData,
    decisions: [`, payloadReplacement);

fs.writeFileSync('scripts/execute-e2e-v1-3-5.ts', content);
