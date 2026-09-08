# AI Director Structured Output Gate

## Previous Failure

Director V1 asked Ollama `qwen3:30b` to reproduce opaque `sourceSegmentIds` and existing timing structure. The model returned JSON with missing required IDs, so strict normalization rejected the response and used the deterministic fallback.

## Contract Change

The AI-facing contract is now smaller and semantic-only. Each section returns an inclusive `startSegment` and `endSegment` number, not canonical IDs or guessed timestamps. The application validates the section schema and resolves numbered ranges to canonical segment IDs and exact segment-safe timing. Canonical identity remains application-owned.

The provider contract is separate from the canonical `SermonAnalysis`. Raw provider evidence is stored independently from `analysis/sermon-analysis.json`.

## Prompt

The request contains Bengali sermon context, the reverent retention policy, numbered transcript segments with index/start/end/text, allowed section types, four allowed intensity levels, allowed visual recommendations, and the compact JSON shape. It excludes source video, project artifacts, renderer internals, FFmpeg details, and opaque IDs.

The model was requested not to invent timestamps and to use `speaker-full` or `none` for calm moments where appropriate.

## Provider

- Provider: Ollama
- Runtime: `0.33.2`
- Model: `qwen3:30b`
- Endpoint: `http://127.0.0.1:11434`
- Request format: JSON mode with `temperature: 0.1`
- Thinking configuration: request sent with `think: false`; this was recorded as configuration, not assumed from model behavior
- Fixture: real Bengali transcript seconds 4000–4400
- Input: 20 numbered segments, 4,534 transcript characters

No other locally installed model was available for comparison. No model was downloaded.

## Structured Reliability

Three repeated runs used identical transcript input and configuration:

| Run | Parse | Schema | Segment references | Semantic output | Fallback | Runtime |
|---|---|---|---|---|---|---:|
| 1 | pass | pass | pass | pass | no | 12.865 s |
| 2 | pass | pass | pass | pass | no | 13.296 s |
| 3 | pass | pass | pass | pass | no | 13.003 s |

Success rate was 3/3 for parsing, schema validation, deterministic segment-reference resolution, and semantic output. The adapter still retains a configurable retry limit and deterministic fallback. Raw response evidence is preserved in `artifacts/director-structured-output/analysis/ai-provider-response.json`.

## Performance

The real 400-second fixture completed in approximately 12.9–13.3 seconds per run after the structured numbered-segment prompt and `think: false` request configuration. The earlier multi-minute behavior was associated with the previous prompt/response behavior and is not representative of this hardened proof.

## Semantic Review

The selected AI output produced four sections:

- `scripture-reading`, 0:00–1:20, `reverent-calm`, `scripture-card`, display text `পিতরের উদ্ধার`; the reference is detection-only and remains review-gated.
- `main-point`, 2:00–2:40, `emphasis`, `keyword-graphic`, display text `প্রার্থনার উত্তর দরজার বাইরে`.
- `illustration`, 4:20–5:40, `story-illustration`, `image-broll`, display text `প্রেসার কুকারের উদাহরণ`; B-roll remains a placeholder.
- `application`, 6:00–6:40, `normal-teaching`, `motion-graphic`, display text `প্রভুর কাছে আসুন`.

The classifications are supported by the supplied transcript ranges. There is meaningful run-to-run variation: the main point moved between neighboring segment ranges and its suggested Bengali label varied between the prayer answer and prayer strength. Scripture references also varied in specificity. These are semantic review items, not identity or timing failures.

## Reverent Retention

The selected Beat Map contains four events at 0.60 non-empty events per minute. It has no rapid switches, no word-destructive edits, and no B-roll retrieval. QA recorded one warning: a `reverent-calm` Scripture section selected `scripture-card` rather than `none` or `speaker-full`. The selected run produced zero explicit no-change beats, so the model demonstrates restraint in density but has not yet demonstrated reliable no-change decisions for this fixture.

## Canonical Integrity

The canonical transcript hash was unchanged before and after provider processing. The AI emitted only numbered segment ranges. Deterministic resolution produced canonical IDs and segment-safe timing. No canonical Bengali text was rewritten, no word-level cuts were emitted, and the Edit Plan contains no destructive word operation.

## Fallback

Fallback was not used in the hardened proof: 0/3 runs required it. The deterministic fallback remains implemented and is used whenever response parsing, schema validation, segment-range validation, or semantic output validation fails.

## Known Problems

- Semantic classification is useful but not yet stable enough to treat as theology or final editorial truth.
- The Scripture reference is unverified and must receive human review.
- The model did not select an explicit no-change decision in the selected run.
- The calm Scripture section received a `scripture-card` warning.
- Run-to-run segment ranges and display labels vary slightly.
- The selected application uses `motion-graphic`; the renderer does not realize that placeholder yet.
- The proof is 400 seconds and does not establish full 35–40 minute behavior.
- B-roll remains recommendation-only.

## Recommendation

**CONDITIONAL GO**

The structured-output boundary is ready for the next Director milestone because all repeated real-fixture responses were schema-valid, deterministically resolved, fast enough for development, and protected canonical transcript identity. Continue human semantic review, improve prompt guidance for calm/no-change decisions, and keep fallback active. Do not begin B-roll integration or full-sermon rendering from this gate alone.
