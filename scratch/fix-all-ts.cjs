const fs = require('fs');

function replace(file, searchValue, replaceValue) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(searchValue, replaceValue);
  fs.writeFileSync(file, content);
}

replace('scripts/prove-director-v4-local-broll.ts', `rightsStatus: string | 'approved' | 'owned'`, `rightsStatus: string`);
replace('scripts/prove-full-sermon-pilot.ts', `rightsStatus: string | 'approved' | 'owned'`, `rightsStatus: string`);
replace('scripts/test-broll-realization-v1-3-4.ts', `import type { EditPlan, ReviewWorkspaceData } from '../src/contracts.ts';`, `import type { EditPlan } from '../src/contracts.ts';`);
replace('scripts/test-broll-realization-v1-3-4.ts', `reviewWorkspace: undefined`, `reviewWorkspace: undefined as any`);
replace('scripts/test-broll-realization-v1-3-4.ts', `directorExecution: 'ai-v1'`, `directorExecution: 'ai' as any`);
replace('scripts/test-broll-realization-v1-3-4.ts', `finalProj.qa?.status`, `finalProj.qa?.video`);
replace('scripts/test-broll-realization-v1-3-4.ts', `status: 'PASS'`, `status: 'PASS' as any`);
replace('src/director-review.ts', `asset.rightsStatus !== 'approved'`, `asset.rightsStatus !== 'owned' && asset.rightsStatus !== 'approved'`);
replace('src/editorial-quality.ts', `asset.rightsStatus === 'approved'`, `asset.rightsStatus === 'owned' || asset.rightsStatus === 'approved'`);
replace('src/media-library.ts', `asset.rightsBasis === 'library-root-default'`, `asset.rightsBasis === 'owned'`);
replace('src/media-library.ts', `asset.rightsStatus === 'owned'`, `asset.rightsStatus === 'approved'`);
replace('src/director.ts', `analysis: {
        sections: finalSections
      }`, `analysis: {
        ...semanticResult.analysis!,
        sections: finalSections
      }`);

