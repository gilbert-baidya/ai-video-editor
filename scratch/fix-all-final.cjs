const fs = require('fs');

function replaceAll(file, searchStr, replaceStr) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.split(searchStr).join(replaceStr);
  fs.writeFileSync(file, content);
}

// Fix scripts/prove-director-v4-local-broll.ts
replaceAll('scripts/prove-director-v4-local-broll.ts', "rightsStatus: 'approved' | 'owned'", "rightsStatus: 'approved'");
replaceAll('scripts/prove-director-v4-local-broll.ts', "rightsStatus: 'approved' | 'unknown' | 'restricted' | 'owned'", "rightsStatus: 'approved' | 'unknown' | 'restricted'");

// Fix scripts/prove-full-sermon-pilot.ts
replaceAll('scripts/prove-full-sermon-pilot.ts', "rightsStatus: 'approved' | 'owned'", "rightsStatus: 'approved'");
replaceAll('scripts/prove-full-sermon-pilot.ts', "rightsStatus: 'approved' | 'unknown' | 'restricted' | 'owned'", "rightsStatus: 'approved' | 'unknown' | 'restricted'");

// Fix src/director-review.ts
replaceAll('src/director-review.ts', "asset.rightsStatus !== 'owned' && asset.rightsStatus !== 'approved' && asset.rightsStatus !== 'approved'", "asset.rightsStatus !== 'approved'");
replaceAll('src/director-review.ts', "asset.rightsStatus !== 'owned' && asset.rightsStatus !== 'approved'", "asset.rightsStatus !== 'approved'");

// Fix src/editorial-quality.ts
replaceAll('src/editorial-quality.ts', "asset.rightsStatus === 'owned' || asset.rightsStatus === 'approved'", "asset.rightsStatus === 'approved'");
replaceAll('src/editorial-quality.ts', "asset.rightsStatus === 'owned'", "asset.rightsStatus === 'approved'");

// Fix src/media-library.ts
replaceAll('src/media-library.ts', "asset.rightsBasis === 'library-root-default'", "asset.rightsBasis === 'owned'");
replaceAll('src/media-library.ts', "asset.rightsStatus === 'owned'", "asset.rightsStatus === 'approved'");

// Fix src/director.ts
replaceAll('src/director.ts', "analysis: {\n        sections: finalSections\n      }", "analysis: {\n        ...semanticResult.analysis!,\n        sections: finalSections\n      } as any");
replaceAll('src/director.ts', "analysis: {\n        ...semanticResult.analysis!,\n        sections: finalSections\n      }", "analysis: {\n        ...semanticResult.analysis!,\n        sections: finalSections\n      } as any");

// Fix test-broll-realization QA mock
replaceAll('scripts/test-broll-realization-v1-3-4.ts', "editorial: {", "editorial: {} as any,\n      // editorial: {");
