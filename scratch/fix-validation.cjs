const fs = require('fs');

let content = fs.readFileSync('src/director.ts', 'utf8');

const oldLines = `    const intensity = stringValue(item.intensity, \`sections[\${index}].intensity\`) as VisualIntensity;
    const visualRecommendation = stringValue(item.visualRecommendation, \`sections[\${index}].visualRecommendation\`) as VisualRecommendation;
    if (!sectionTypes.has(sectionType)) throw new Error(\`Unsupported section type: \${sectionType}\`);
    if (!intensities.has(intensity)) throw new Error(\`Unsupported intensity: \${intensity}\`);
    if (!visualRecommendations.has(visualRecommendation)) throw new Error(\`Unsupported visual recommendation: \${visualRecommendation}\`);
    const startSegment = numberValue(item.startSegment, \`sections[\${index}].startSegment\`);
    const endSegment = numberValue(item.endSegment, \`sections[\${index}].endSegment\`);
    const confidence = numberValue(item.confidence, \`sections[\${index}].confidence\`);`;

const newLines = `    const intensity = (item.intensity ? stringValue(item.intensity, \`sections[\${index}].intensity\`) : 'normal-teaching') as VisualIntensity;
    const visualRecommendation = (item.visualRecommendation ? stringValue(item.visualRecommendation, \`sections[\${index}].visualRecommendation\`) : 'speaker-full') as VisualRecommendation;
    if (!sectionTypes.has(sectionType)) throw new Error(\`Unsupported section type: \${sectionType}\`);
    if (!intensities.has(intensity)) throw new Error(\`Unsupported intensity: \${intensity}\`);
    if (!visualRecommendations.has(visualRecommendation)) throw new Error(\`Unsupported visual recommendation: \${visualRecommendation}\`);
    const startSegment = numberValue(item.startSegment, \`sections[\${index}].startSegment\`);
    const endSegment = numberValue(item.endSegment, \`sections[\${index}].endSegment\`);
    const confidence = item.confidence ? numberValue(item.confidence, \`sections[\${index}].confidence\`) : 1.0;`;

content = content.replace(oldLines, newLines);

// Also reason needs a default
const oldReason = `      confidence,
      reason: stringValue(item.reason, \`sections[\${index}].reason\`),`;

const newReason = `      confidence,
      reason: item.reason ? stringValue(item.reason, \`sections[\${index}].reason\`) : 'Semantic pass',`;
      
content = content.replace(oldReason, newReason);

fs.writeFileSync('src/director.ts', content);
