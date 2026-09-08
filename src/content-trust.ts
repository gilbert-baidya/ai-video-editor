import type { DisplayTextTrust, SermonAnalysis, SermonSection } from './contracts.ts';

export interface ContentTrustPolicy {
  mode: 'preview' | 'final';
  approvedDisplayTextBySection?: Record<string, string>;
}

export interface ResolvedDisplayText {
  text?: string;
  trust: DisplayTextTrust;
  warning?: string;
}

export const previewContentTrustPolicy: ContentTrustPolicy = { mode: 'preview' };

function scriptureIsVerified(section: SermonSection, analysis: SermonAnalysis): boolean {
  return [analysis.mainPassage, ...analysis.supportingPassages]
    .filter((passage) => passage !== undefined)
    .some((passage) => passage.verificationStatus === 'verified' && passage.start < section.end && section.start < passage.end);
}

export function resolveDisplayText(section: SermonSection, analysis: SermonAnalysis, policy: ContentTrustPolicy = previewContentTrustPolicy): ResolvedDisplayText {
  const approved = policy.approvedDisplayTextBySection?.[section.id]?.trim();
  if (approved) return { text: approved, trust: 'approved-display' };

  if (section.visualRecommendation === 'scripture-card') {
    if (!scriptureIsVerified(section, analysis)) {
      return {
        text: section.scriptureReference?.trim(),
        trust: 'scripture-reference-needs-review',
        warning: 'Scripture verse text is withheld until the reference is verified.',
      };
    }
    return {
      text: section.suggestedDisplayText?.trim() || section.scriptureReference?.trim(),
      trust: 'verified-scripture',
    };
  }

  if (policy.mode === 'preview' && section.suggestedDisplayText?.trim()) {
    return { text: section.suggestedDisplayText.trim(), trust: 'ai-suggested-unapproved', warning: 'Preview-only AI display text; not approved for final export.' };
  }

  return { text: section.transcriptText.trim(), trust: 'canonical-transcript' };
}