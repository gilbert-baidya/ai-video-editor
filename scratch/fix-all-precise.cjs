const fs = require('fs');

function replaceAll(file, searchStr, replaceStr) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.split(searchStr).join(replaceStr);
  fs.writeFileSync(file, content);
}

replaceAll('scripts/prove-director-v4-local-broll.ts', "value === 'owned' || value === 'approved' ? value : 'unknown'", "value === 'approved' ? value : 'unknown'");
replaceAll('scripts/prove-full-sermon-pilot.ts', "value === 'owned' || value === 'approved' ? value : 'unknown'", "value === 'approved' ? value : 'unknown'");
replaceAll('src/editorial-quality.ts', "asset.rightsStatus !== 'approved' && asset.rightsStatus !== 'approved'", "asset.rightsStatus !== 'approved'");
replaceAll('src/media-library.ts', "previous.rightsBasis === 'library-root-default'", "previous.rightsBasis === 'owned'");
replaceAll('src/media-library.ts', "status === 'owned' || status === 'approved'", "status === 'approved'");

