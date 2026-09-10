import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('src/director.ts', 'utf8');

const oldResolve = `      type: section.sectionType,
      intensity: section.intensity,
      suggestedDisplayText: section.suggestedDisplayText,
      scriptureReference: section.scriptureReference,
      visualRecommendation: section.visualRecommendation,
      confidence: section.confidence,
      reason: section.reason,`;

const newResolve = `      type: section.sectionType,
      secondaryType: section.secondaryType,
      semanticConfidence: section.semanticConfidence,
      semanticEvidence: section.semanticEvidence,
      intensity: section.intensity,
      suggestedDisplayText: section.suggestedDisplayText,
      scriptureReference: section.scriptureReference,
      visualRecommendation: section.visualRecommendation,
      confidence: section.confidence,
      reason: section.reason,`;

content = content.replace(oldResolve, newResolve);
writeFileSync('src/director.ts', content);
