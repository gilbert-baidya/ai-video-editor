const fs = require('fs');

let content = fs.readFileSync('src/product-orchestrator.ts', 'utf8');
content = content.replace(
  'const realization = auditPlanRealization(resolved.approvedPlan, workspace.mediaIndex.assets);',
  'const realization = auditPlanRealization(resolved.approvedPlan, record.assets.length > 0 ? record.assets : workspace.mediaIndex.assets);'
);
fs.writeFileSync('src/product-orchestrator.ts', content);
