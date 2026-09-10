import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('src/director.ts', 'utf8');

// Replace AISermonSection with Semantic/Visual split inside AI validation
content = content.replace(
  `export interface AISermonSection {
  sectionType: SermonSectionType;
  startSegment: number;
  endSegment: number;
  intensity: VisualIntensity;
  suggestedDisplayText?: string;
  scriptureReference?: string;
  visualRecommendation: VisualRecommendation;
  confidence: number;
  reason: string;
}`,
  `export interface AISermonSection {
  sectionType: SermonSectionType;
  secondaryType?: SermonSectionType;
  semanticConfidence: number;
  semanticEvidence: string;
  
  startSegment: number;
  endSegment: number;
  
  intensity: VisualIntensity;
  suggestedDisplayText?: string;
  scriptureReference?: string;
  visualRecommendation: VisualRecommendation;
  confidence: number;
  reason: string;
}`
);

writeFileSync('src/director.ts', content);
