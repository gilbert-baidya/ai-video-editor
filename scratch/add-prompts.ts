import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('src/director.ts', 'utf8');

const newPrompts = `
export function semanticAnalysisPromptFor(input: DirectorInput): string {
  const indices = primarySegmentIndices(input);
  return [
    'You are a reverent Bengali sermon semantic extractor.',
    'Return only one JSON object. Do not include markdown, prose, timestamps, project IDs, or source IDs.',
    'Use inclusive numbered transcript segment ranges. The application resolves identity and timing.',
    'Your ONLY job is to classify the semantic nature of the content.',
    'If a section serves multiple purposes (e.g. a story that teaches a point), provide both a sectionType (primary) and a secondaryType.',
    'Provide semanticEvidence referencing the transcript structure. Do not expose chain-of-thought.',
    'Allowed sectionType and secondaryType: introduction, scripture-reading, teaching, main-point, illustration, story, testimony, question, application, transition, prayer, emotional-ministry, conclusion, altar-call.',
    'JSON shape: {"sections":[{"sectionType":"story","secondaryType":"main-point","startSegment":0,"endSegment":0,"semanticConfidence":0.9,"semanticEvidence":"Pastor recounts the narrative of Paul in Rome"}],"overallConfidence":0.0}.',
    'Do not omit required fields.',
    ...coverageRules,
    \`Primary segment indices requiring complete coverage: \${indices.join(', ')}.\`,
    \`Numbered transcript segments:\\n\${numberedSegments(input)}\`,
  ].join('\\n');
}

export function visualDecisionPromptFor(input: DirectorInput, semantics: SermonAnalysis): string {
  return [
    'You are a reverent Bengali sermon visual director.',
    'Return only one JSON object matching the provided semantic sections exactly.',
    'Do NOT change startSegment, endSegment, sectionType, or secondaryType.',
    'For each section, determine the visualRecommendation and intensity.',
    'Respect that prayer, Scripture, altar call, and emotional ministry often need speaker-full or none.',
    'Reverent Retention does not mean visual inactivity. For ordinary teaching, stories, questions, and emphasis, consider restrained captions, sermon points, punch-ins, reframes, Scripture treatments, contextual B-roll, or an intentional visual reset when semantically useful.',
    'Stories and illustrations: actively consider contextual B-roll first; when B-roll is not semantically justified, consider a caption, punch-in, or reframe.',
    'No Change is deliberate, not the safest default. For eligible normal teaching/story/emphasis sections, explain why No Change is better than the available restrained alternatives.',
    'If your rationale says contextual B-roll is appropriate, then choose image-broll unless you explicitly justify why remaining on the speaker is better.',
    'If you select speaker-full or none for a HIGH-opportunity story, provide a specific deliberate-speaker-led justification.',
    'Allowed intensity: reverent-calm, normal-teaching, story-illustration, emphasis.',
    'Allowed editorialIntent: PRESERVE_SPEAKER, EMPHASIZE_SPEAKER, SHOW_KEY_TEXT, SHOW_SCRIPTURE, USE_CONTEXTUAL_VISUAL, VISUAL_RESET.',
    'Allowed visualRecommendation: speaker-full, speaker-left, speaker-right, speaker-punch-in, caption, scripture-card, title-card, keyword-graphic, image-broll, video-broll, motion-graphic, split-screen, none.',
    'JSON shape: {"sections":[{"sectionType":"story","startSegment":0,"endSegment":0,"intensity":"story-illustration","editorialIntent":"USE_CONTEXTUAL_VISUAL","suggestedDisplayText":"optional Bengali label","scriptureReference":"optional","visualRecommendation":"image-broll","confidence":0.9,"reason":"Visualizes Paul in Rome"}],"overallConfidence":0.0}.',
    \`Numbered transcript segments:\\n\${numberedSegments(input)}\`,
    \`Stable Semantic Classification to apply visual decisions to:\\n\${JSON.stringify(semantics.sections.map(s => ({ sectionType: s.type, secondaryType: s.secondaryType, startSegment: s.start, endSegment: s.end, semanticEvidence: s.semanticEvidence })), null, 2)}\`
  ].join('\\n');
}

export function semanticReconciliationPromptFor(input: DirectorInput, sections: any[]): string {
  return [
    'You are a reverent Bengali sermon semantic reconciler.',
    'Return only one JSON object updating the semantic classification of the provided sections.',
    'Some sections were flagged as AMBIGUOUS because they contain strong narrative evidence (e.g. telling a story, recounting events) but were classified only as teaching or main-point.',
    'Review the transcript and if a section is genuinely narrative, update its sectionType or secondaryType to story, illustration, or testimony.',
    'Do NOT change startSegment or endSegment boundaries. Only reconsider the semantic classification.',
    'JSON shape: {"sections":[{"sectionType":"story","secondaryType":"main-point","startSegment":0,"endSegment":0,"semanticConfidence":0.9,"semanticEvidence":"Pastor recounts the narrative"}],"overallConfidence":0.0}.',
    \`Numbered transcript segments:\\n\${numberedSegments(input)}\`,
    \`Sections requiring reconciliation:\\n\${JSON.stringify(sections, null, 2)}\`
  ].join('\\n');
}
`;

content += newPrompts;
writeFileSync('src/director.ts', content);
