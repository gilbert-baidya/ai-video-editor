import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('src/director.ts', 'utf8');

const oldValidate = `    const confidence = numberValue(item.confidence, \`sections[\${index}].confidence\`);
    if (!Number.isInteger(startSegment) || !Number.isInteger(endSegment) || startSegment < 0 || endSegment < startSegment || endSegment >= segmentCount) throw new Error(\`Invalid segment range at sections[\${index}]: \${startSegment}-\${endSegment}\`);
    if (confidence < 0 || confidence > 1) throw new Error(\`Invalid confidence at sections[\${index}].confidence\`);
    return {
      sectionType,
      startSegment,
      endSegment,
      intensity,
      visualRecommendation,
      suggestedDisplayText: optionalStringValue(item.suggestedDisplayText, \`sections[\${index}].suggestedDisplayText\`),
      scriptureReference: optionalStringValue(item.scriptureReference, \`sections[\${index}].scriptureReference\`),
      confidence,
      reason: stringValue(item.reason, \`sections[\${index}].reason\`),
    };`;

const newValidate = `    const confidence = numberValue(item.confidence, \`sections[\${index}].confidence\`);
    const semanticConfidence = item.semanticConfidence ? numberValue(item.semanticConfidence, \`sections[\${index}].semanticConfidence\`) : confidence;
    if (!Number.isInteger(startSegment) || !Number.isInteger(endSegment) || startSegment < 0 || endSegment < startSegment || endSegment >= segmentCount) throw new Error(\`Invalid segment range at sections[\${index}]: \${startSegment}-\${endSegment}\`);
    if (confidence < 0 || confidence > 1) throw new Error(\`Invalid confidence at sections[\${index}].confidence\`);
    return {
      sectionType,
      secondaryType: item.secondaryType ? stringValue(item.secondaryType, \`sections[\${index}].secondaryType\`) as any : undefined,
      semanticConfidence,
      semanticEvidence: item.semanticEvidence ? stringValue(item.semanticEvidence, \`sections[\${index}].semanticEvidence\`) : '',
      startSegment,
      endSegment,
      intensity,
      visualRecommendation,
      suggestedDisplayText: optionalStringValue(item.suggestedDisplayText, \`sections[\${index}].suggestedDisplayText\`),
      scriptureReference: optionalStringValue(item.scriptureReference, \`sections[\${index}].scriptureReference\`),
      confidence,
      reason: stringValue(item.reason, \`sections[\${index}].reason\`),
    };`;

content = content.replace(oldValidate, newValidate);
writeFileSync('src/director.ts', content);
