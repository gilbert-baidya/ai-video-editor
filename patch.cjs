const fs = require('fs');
let content = fs.readFileSync('src/product-renderer.ts', 'utf8');

const target1 = `    const durationSeconds = record.sourceMetadata?.durationSeconds;
    if (!durationSeconds || durationSeconds <= 0) throw new Error('Source duration must be known before rendering.');`;

const replacement1 = `    const { discoverCapabilities } = await import('./product-capabilities.ts');
    const capabilities = await discoverCapabilities({ root: appRoot });
    const { probeSource } = await import('./source-ingestion.ts');
    const probedSource = await probeSource(sourcePath, capabilities.ffprobe);
    const actualDuration = probedSource.durationSeconds;
    let durationSeconds = record.sourceMetadata?.durationSeconds;
    if (!durationSeconds || durationSeconds <= 0) throw new Error('Source duration must be known before rendering.');
    if (actualDuration && actualDuration > 0 && Math.abs(durationSeconds - actualDuration) > 0.1) {
      durationSeconds = Math.min(durationSeconds, actualDuration);
    }`;

content = content.replace(target1, replacement1);

const target2 = `      const { discoverCapabilities } = await import('./product-capabilities.ts');
      const capabilities = await discoverCapabilities({ root: appRoot });`;

content = content.replace(target2, '');

fs.writeFileSync('src/product-renderer.ts', content);
