const fs = require('fs');

function replace(file, searchStr, replaceStr) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.split(searchStr).join(replaceStr);
  fs.writeFileSync(file, content);
}

replace('scripts/prove-director-v4-local-broll.ts', "rightsStatus: 'approved' | 'owned'", "rightsStatus: string");
replace('scripts/prove-director-v4-local-broll.ts', "rightsStatus: 'approved' | 'unknown' | 'restricted' | 'owned'", "rightsStatus: string");

replace('scripts/prove-full-sermon-pilot.ts', "rightsStatus: 'approved' | 'owned'", "rightsStatus: string");
replace('scripts/prove-full-sermon-pilot.ts', "rightsStatus: 'approved' | 'unknown' | 'restricted' | 'owned'", "rightsStatus: string");

// src/editorial-quality.ts line 78
replace('src/editorial-quality.ts', "asset.rightsStatus === 'owned' || asset.rightsStatus === 'approved' || asset.rightsStatus === 'approved'", "asset.rightsStatus === 'approved'");
replace('src/editorial-quality.ts', "asset.rightsStatus === 'owned' || asset.rightsStatus === 'approved'", "asset.rightsStatus === 'approved'");

// src/media-library.ts line 114
replace('src/media-library.ts', "asset.rightsBasis === 'library-root-default'", "asset.rightsBasis === 'owned'");

// src/media-library.ts line 208
replace('src/media-library.ts', "asset.rightsStatus === 'owned'", "asset.rightsStatus === 'approved'");

