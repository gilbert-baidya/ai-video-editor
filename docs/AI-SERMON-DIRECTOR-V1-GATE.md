# AI Sermon Director V1 Gate

## Input

The proof uses the authoritative persisted Bengali transcript from `sermonclip-studio/Projects/GOLDEN-E2E---Intervention-Sermon-2/Transcript/transcript.json`, read-only, for source seconds 4000–4400. The proof fixture is 400 seconds long and retains the source segment boundaries with relative timestamps.

The fixture includes prayer, the Peter prison-release story, the explicit intervention sermon point, a pressure-cooker illustration, and application.

## Canonical Transcript

The existing-project transcript is the canonical text source for this proof. It is copied into `artifacts/director-v1/input-transcript.json` and is never rewritten by the Director. Timing confidence is `segment-safe`; no word-level destructive edit is permitted. Bengali human review remains required because the persisted transcript contains boundary artifacts and is not certified theological ground truth.

## Sermon Analysis

The analysis contract now separates sections, main points, key statements, Scripture references, stories, illustrations, applications, prayer moments, and emotional moments. The fallback analysis identified five sections:

- prayer: 0:00–1:20
- story: 1:20–3:40
- main point: 3:40–4:00
- illustration: 4:00–5:40
- application: 5:40–6:40

The detected passage is recorded as `Acts 12` with review status. No verse text was invented.

## Visual Intensity

The Director uses exactly four levels: `reverent-calm`, `normal-teaching`, `story-illustration`, and `emphasis`. Prayer is calm, the Peter narrative and pressure-cooker example are story-illustration, the intervention point is emphasis, and the application is emphasis.

## Reverent Retention

The proof produced five beats across 6 minutes 40 seconds. Prayer deliberately has `none` as its visual decision. There are no rapid speaker switches, punch-ins, or decorative transitions. Story and illustration beats are recommendations only; no B-roll was retrieved or downloaded.

## Beat Map

The persisted beat map is at `artifacts/director-v1/edit/beatmap.json`. It contains one no-change prayer beat, one story B-roll placeholder, one intervention keyword graphic, one illustration B-roll placeholder, and one restrained speaker-position application beat.

## Edit Plan

The persisted Edit Plan is at `artifacts/director-v1/edit/edit-plan.json`. Renderer-supported operations are limited to the existing speaker-position and sermon-point operations. `director-placeholder` operations are explicit non-rendering recommendations for future review and media selection.

## Display Text Protection

Canonical Bengali text is stored in `originalTranscript` and `transcriptText`. Suggested display text is stored separately in `suggestedDisplayText` or the existing sermon-point `text`. The proof does not overwrite canonical text. The example intervention graphic is `হস্তক্ষেপ`, derived as a suggested display label, not a transcript replacement.

## AI Provider

Ollama was available at `http://127.0.0.1:11434` with `qwen3:30b`. The provider adapter is structured-JSON-only and accepts the model's JSON from either the `response` or `thinking` field because this runtime returned JSON in `thinking`.

The actual Director run was rejected because the model output omitted required `sourceSegmentIds`. The deterministic fallback was used and recorded in `artifacts/director-v1/provider.json`. This is a safe failure mode, not a claim of successful semantic model direction.

## Structured Output Reliability

The provider retries malformed or unusable output twice, rejects missing timing references, and falls back without mutating the transcript. A minimal API probe confirmed the local model is running, but the full Director response did not satisfy the required source-segment contract.

## Event Density

QA recorded:

- total beats: 5
- non-empty visual events: 4
- event density: 0.60 non-empty events per minute
- QA status: PASS

This is below the intended long-form target range and demonstrates that the policy permits `NO VISUAL CHANGE` rather than forcing constant activity. The proof is too short to establish 35–40 minute behavior.

## Cache

The dependency path is:

`canonical-transcript -> sermon-analysis -> visual-intensity-map -> beatmap -> edit-plan -> render`

The proof persists hashes for the canonical transcript, policy, analysis, beat map, and Edit Plan in `artifacts/director-v1/cache.json`. Style inputs are marked as affecting render only.

## QA

The Director validator checks range validity, duration bounds, confidence range, allowed section/intensity values, illegal Edit Plan overlap, repeated visual decisions, event density, and no-change beats. It passed this proof with no failures. Word-level destructive edits are not emitted.

## Known Problems

- Ollama `qwen3:30b` did not return the required segment references in the Director response.
- The fallback semantic labels are deterministic proof labels, not human-approved theology.
- The persisted Bengali transcript still requires human Bengali review.
- Scripture detection is detection-only and not externally verified.
- B-roll is a placeholder; no retrieval or download exists.
- The current Remotion renderer does not realize Director placeholders or the full intensity vocabulary.
- The 400-second proof does not establish full-sermon event density.

## Recommendation

**CONDITIONAL GO**

Proceed to the next Director milestone only after adding model-output repair/schema prompting or selecting a model that reliably returns source-segment references, and after human Bengali/theological review of the generated analysis. Keep the deterministic fallback and placeholder-only B-roll policy. Do not begin full-sermon rendering from this gate alone.
