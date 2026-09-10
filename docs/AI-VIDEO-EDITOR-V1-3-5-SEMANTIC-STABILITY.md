# AI Video Editor V1.3.5 — Semantic Classification Stability

## Executive Summary
Prior to V1.3.5, the Director AI (`OllamaDirectorProvider`) was structured as a single-pass inference process. The LLM was asked to generate a single JSON object containing both the semantic analysis (what the segment is) and the visual recommendation (what to show on screen) simultaneously. 

This architectural flaw allowed downstream visual constraints to "contaminate" upstream semantic reality. If the model felt it lacked good B-roll ideas, or if it wanted to prioritize an on-screen caption, it would subconsciously re-classify a narrative story as a \`main-point\` or \`teaching\` segment to justify its visual choice. This phenomenon ("model drift") caused previously identified stories to lose their narrative status, thereby dropping B-roll recommendations entirely and failing our Editorial Opportunity policies.

## Architectural Fix: The Two-Pass Director Algorithm

To enforce semantic stability, V1.3.5 explicitly separates the Director's decision-making into a two-pass pipeline, conceptually enforcing the following strict sequence:
1. **Canonical Transcript**
2. **Semantic Section Classification** (Pass 1)
3. **Editorial Opportunity Evaluation** (Policy boundary)
4. **Visual Decision** (Pass 2)

### Pass 1: Semantic Classification
The first prompt exclusively asks the model to define the *nature* of the content without any knowledge of visual rendering options. 
- The model outputs `sectionType` (primary semantic role) and `secondaryType` (secondary semantic role).
- It provides `semanticEvidence` quoting the transcript structure, avoiding chain-of-thought hallucination.
- A deterministic check (\`validateClassificationAmbiguity\`) assesses the evidence. If the section contains strong narrative verbs (e.g., "story", "recount", "event") but lacks a narrative label, it is flagged as \`AMBIGUOUS\`.
- If ambiguity is detected, the system executes **ONE bounded reconciliation prompt** asking the model to reconsider the semantic classification in light of the narrative evidence, without altering canonical segment boundaries or timing.

### Pass 2: Visual Decision
Once the semantic state is locked, a second independent prompt is dispatched to the model.
- The prompt is provided with the *stable* semantic classification from Pass 1.
- The model's strict constraint is to map those exact semantic segments to visual treatments (\`visualRecommendation\`, \`intensity\`).
- Crucially, the model is **prohibited** from altering the segment boundaries, primary types, or secondary types. The visual recommendation can no longer retroactively influence the semantic classification.

## Policy Upgrades
- The \`determineStoryTreatment\` logic now considers both the primary \`type\` and \`secondaryType\`. A section labeled as \`main-point\` (primary) and \`story\` (secondary) will still receive narrative visual opportunity (High opportunity for B-roll).
- Semantic stability is now aggressively monitored via the \`evaluateSemanticStability\` diagnostic, tracking exact state variations (\`STABLE\`, \`COMPATIBLE_VARIATION\`, \`UNSTABLE\`).

This separation guarantees that even if the AI decides a story shouldn't have B-roll on a given run, it cannot erase the fact that the section *is* a story, preserving downstream analytics and human review workflows.
