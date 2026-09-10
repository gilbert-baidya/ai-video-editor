import { readFileSync, writeFileSync } from 'fs';
let content = readFileSync('src/director-review.ts', 'utf8');
content = content.replace(
  `if (asset.rightsStatus !== 'owned' && asset.rightsStatus !== 'approved') blockers.push(\`\${beat.section.id}: selected media rights require review.\`);`,
  `console.log("CHECKING RIGHTS:", asset.rightsStatus); if (asset.rightsStatus !== 'owned' && asset.rightsStatus !== 'approved') { console.log("ADDING BLOCKER"); blockers.push(\`\${beat.section.id}: selected media rights require review.\`); }`
);
writeFileSync('src/director-review.ts', content);
