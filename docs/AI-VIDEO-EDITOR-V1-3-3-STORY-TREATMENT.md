# AI Video Editor V1.3.3: Story Treatment & Director Consistency

## The Problem
In V1.3.2, the Director identified stories effectively and logically reasoned that they required contextual B-roll to enhance the narrative. However, the model would hallucinate the structural output and emit a `speaker-full` decision, explicitly contradicting its own rationale. Because minor edits elsewhere inflated the overall density of the video, this contradiction evaded the `LOW-ACTIVITY` enrichment pass, resulting in videos passing through human review with entirely unedited stories.

## The V1.3.3 Solution

V1.3.3 introduces strict **Editorial Intent** tracking and **Decision Consistency** guardrails directly into the Director pipeline.

### 1. Editorial Intent Schema
We added `editorialIntent` to the `SermonSection` interface (e.g., `PRESERVE_SPEAKER`, `EMPHASIZE_SPEAKER`, `USE_CONTEXTUAL_VISUAL`). The prompt requires the AI to explicitly declare its intent first, binding the structural decision (`type`) to the declared intent.

### 2. Story Treatment Tracking
`determineStoryTreatment(type, intent)` now classifies story segments as:
- `TREATED` (B-roll, caption, reframe, or punch-in).
- `DELIBERATE_SPEAKER_LED` (The AI explicitly requested `PRESERVE_SPEAKER` and emitted `speaker-full`).
- `UNTREATED` (The AI defaulted to `speaker-full` without a deliberate rationale).

### 3. Decision Consistency Guardrails
`validateDecisionConsistency(type, intent)` compares the structural output to the declared intent:
- If `intent === 'USE_CONTEXTUAL_VISUAL'` but `type === 'no-change'`, a contradiction is flagged.
- Contradictions explicitly increment `decisionConsistencyFailures` in the `DirectorQualitySummary`.

### 4. Enrichment Triggers
The enrichment pipeline no longer relies strictly on a density benchmark. It now automatically triggers if:
- `untreatedStorySections > 0`
- `decisionConsistencyFailures > 0`
- `status === 'LOW-ACTIVITY'`

### 5. Fallback Protection
Enrichment passes run in a bounded, isolated context. If the enrichment model hallucinates and drops a canonical transcript segment (`canonical-coverage` failure), the pipeline automatically intercepts the failure, rejects the corrupt enrichment JSON, and safely preserves the base plan.

## Real Validation Result
During real validation on a known problematic YouTube Short (`lPN9AWaTuEc`), the V1.3.3 framework forced the `qwen3:30b` model to align its rationale with its structure. The model explicitly output an `image-broll` placeholder for the detected story, resulting in `0` untreated stories and `0` decision consistency failures. The subsequent `LOW-ACTIVITY` enrichment was successfully guarded by the canonical integrity checks.
