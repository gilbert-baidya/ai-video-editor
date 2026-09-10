const fs = require('fs');

let content = fs.readFileSync('src/director.ts', 'utf8');

const search = `    if (!Number.isInteger(startSegment) || !Number.isInteger(endSegment) || startSegment < 0 || endSegment < startSegment || endSegment >= segmentCount) throw new Error(\`Invalid segment range at sections[\${index}]: \${startSegment}-\${endSegment}\`);`;

const replace = `    if (!Number.isInteger(startSegment) || !Number.isInteger(endSegment) || startSegment < 0 || endSegment < startSegment) throw new Error(\`Invalid segment range at sections[\${index}]: \${startSegment}-\${endSegment}\`);
    if (startSegment >= segmentCount) throw new Error(\`Invalid segment range at sections[\${index}]: \${startSegment}-\${endSegment}\`);
    const validEndSegment = Math.min(endSegment, segmentCount - 1);`;

content = content.replace(search, replace);
content = content.replace(/endSegment,\n      intensity/g, 'endSegment: validEndSegment,\n      intensity');

fs.writeFileSync('src/director.ts', content);
