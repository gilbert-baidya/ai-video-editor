const fs = require('fs');

function replace(file, searchStr, replaceStr) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.split(searchStr).join(replaceStr);
  fs.writeFileSync(file, content);
}

replace('scripts/execute-e2e-v1-3-5.ts', "url: 'https://youtube.com/shorts/lPN9AWaTuEc' }", "url: 'https://youtube.com/shorts/lPN9AWaTuEc', ingestionAvailable: true }");
replace('scripts/execute-e2e-v1-3-5.ts', "console.log('QA Passed:', proj.qa?.status);", "console.log('QA Passed:', proj.qa?.video);");
replace('scripts/execute-e2e-v1-3-5.ts', "createRemotionRenderAdapter()", "createRemotionRenderAdapter({} as any)");

replace('scripts/benchmark-v1-3-5.ts', "url: 'https://youtube.com/shorts/lPN9AWaTuEc' }", "url: 'https://youtube.com/shorts/lPN9AWaTuEc', ingestionAvailable: true }");
replace('scripts/benchmark-v1-3-5.ts', "createRemotionRenderAdapter()", "createRemotionRenderAdapter({} as any)");

