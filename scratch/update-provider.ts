import { readFileSync, writeFileSync } from 'fs';

let content = readFileSync('src/director.ts', 'utf8');

const oldAnalyze = `  async analyze(input: DirectorInput): Promise<DirectorProviderResult> {
    const required = resolvePrimarySegmentIds(input.segments, input.primarySegmentIds);
    return this.generate(input, promptFor(input), 'analysis', required);
  }`;

const newAnalyze = `  async analyze(input: DirectorInput): Promise<DirectorProviderResult> {
    const required = resolvePrimarySegmentIds(input.segments, input.primarySegmentIds);
    
    // Pass 1: Semantics
    let semanticResult = await this.generate(input, semanticAnalysisPromptFor(input), 'analysis', required);
    if (semanticResult.providerResult !== 'ai-success' && semanticResult.providerResult !== 'ai-retry-success') return semanticResult;
    
    // Check for ambiguity
    let ambiguous = false;
    for (const sec of semanticResult.analysis!.sections) {
      if (validateClassificationAmbiguity(sec)) {
        ambiguous = true;
        break;
      }
    }
    
    if (ambiguous) {
      // Reconcile once
      const reconResult = await this.generate(input, semanticReconciliationPromptFor(input, semanticResult.analysis!.sections), 'analysis', required, 1);
      if (reconResult.providerResult === 'ai-success' || reconResult.providerResult === 'ai-retry-success') {
        semanticResult = reconResult;
      }
    }
    
    // Pass 2: Visuals
    const visualResult = await this.generate(input, visualDecisionPromptFor(input, semanticResult.analysis!), 'analysis', required);
    if (visualResult.providerResult !== 'ai-success' && visualResult.providerResult !== 'ai-retry-success') return visualResult;
    
    // Combine Semantics and Visuals
    const finalSections = semanticResult.analysis!.sections.map(semSec => {
      const visSec = visualResult.analysis!.sections.find(v => v.start === semSec.start && v.end === semSec.end) || visualResult.analysis!.sections.find(v => v.id === semSec.id);
      if (!visSec) return semSec;
      return {
        ...semSec,
        intensity: visSec.intensity,
        suggestedDisplayText: visSec.suggestedDisplayText,
        scriptureReference: visSec.scriptureReference,
        editorialIntent: visSec.editorialIntent,
        visualRecommendation: visSec.visualRecommendation,
        confidence: Math.min(semSec.confidence, visSec.confidence),
        reason: visSec.reason
      };
    });
    
    return {
      ...visualResult,
      attempts: [...semanticResult.attempts, ...visualResult.attempts],
      rawResponses: [...semanticResult.rawResponses, ...visualResult.rawResponses],
      analysis: {
        ...semanticResult.analysis!,
        sections: finalSections
      } as any
    };
  }`;

content = content.replace(oldAnalyze, newAnalyze);
writeFileSync('src/director.ts', content);
