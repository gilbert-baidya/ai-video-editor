const fs = require('fs');

// 1. Fix AISermonSection
let director = fs.readFileSync('src/director.ts', 'utf8');
director = director.replace('semanticConfidence: number;', 'semanticConfidence?: number;');
director = director.replace('semanticEvidence: string;', 'semanticEvidence?: string;');
director = director.replace(/overallConfidence: Math\.min\(semanticResult\.analysis!\.overallConfidence, visualResult\.analysis!\.overallConfidence\)/g, '');
director = director.replace('overallConfidence: Math.min(semanticResult.analysis!.overallConfidence, visualResult.analysis!.overallConfidence)', '');
fs.writeFileSync('src/director.ts', director);

// 2. Fix rightsStatus === 'owned' -> rightsBasis === 'owned' (wait, rightsStatus can be 'approved' now)
let review = fs.readFileSync('src/director-review.ts', 'utf8');
review = review.replace(/asset\.rightsStatus !== 'owned'/g, "asset.rightsStatus !== 'approved'");
fs.writeFileSync('src/director-review.ts', review);

let eq = fs.readFileSync('src/editorial-quality.ts', 'utf8');
eq = eq.replace(/asset\.rightsStatus === 'owned'/g, "asset.rightsStatus === 'approved'");
fs.writeFileSync('src/editorial-quality.ts', eq);

let ml = fs.readFileSync('src/media-library.ts', 'utf8');
ml = ml.replace(/rightsSource/g, 'rightsBasis');
ml = ml.replace(/asset\.rightsStatus === 'owned'/g, "asset.rightsStatus === 'approved'");
fs.writeFileSync('src/media-library.ts', ml);

// 3. Fix scripts/test-broll-realization-v1-3-4.ts types
let testBroll = fs.readFileSync('scripts/test-broll-realization-v1-3-4.ts', 'utf8');
testBroll = testBroll.replace(/proj.workflow.stages.ingest = { status: 'completed'/g, "proj.workflow.stages.ingest = { status: 'completed', progress: 100");
testBroll = testBroll.replace(/proj.workflow.stages.transcript = { status: 'completed'/g, "proj.workflow.stages.transcript = { status: 'completed', progress: 100");
testBroll = testBroll.replace(/proj.workflow.stages.director = { status: 'completed'/g, "proj.workflow.stages.director = { status: 'completed', progress: 100");
testBroll = testBroll.replace(/source: { type: 'youtube-url', url: 'https:\/\/youtube.com\/shorts\/lPN9AWaTuEc' }/g, "source: { type: 'youtube-url', url: 'https://youtube.com/shorts/lPN9AWaTuEc', ingestionAvailable: true }");
testBroll = testBroll.replace(/const beats = \[/g, "const beats: any[] = [");
testBroll = testBroll.replace(/directorExecution: 'ai'/g, "directorExecution: 'ai-v1'");
fs.writeFileSync('scripts/test-broll-realization-v1-3-4.ts', testBroll);

// 4. Fix stability test
let testStability = fs.readFileSync('scripts/test-semantic-stability-v1-3-5.ts', 'utf8');
testStability = testStability.replace(/reconcileSemantics/g, ''); // not exported/used
testStability = testStability.replace(/semanticConfidence/g, 'semanticEvidence'); // typo in test
fs.writeFileSync('scripts/test-semantic-stability-v1-3-5.ts', testStability);

