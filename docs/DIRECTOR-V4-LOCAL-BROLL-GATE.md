# Director V4 Gate: Local B-roll Library + Semantic Media Matching

**Verdict: CONDITIONAL GO**

## Scope

Director V4 adds a local-only media index, explainable semantic candidate ranking, explicit rights gating, first-class `no-broll` decisions, and renderer support for muted full-screen or split B-roll. It does not download stock media, call cloud search, alter the canonical transcript, or modify original source media.

## Evidence

- Proof command: `npm run prove-director-v4-local-broll`
- Bounded source: `public/proof-source.mp4`, 120 seconds
- Control preview: `artifacts/director-v4-local-broll/control-preview.mp4`
- Director preview: `artifacts/director-v4-local-broll/director-preview.mp4`
- Indexed assets: 3 local video files
- Selected automated B-roll assets: 0
- Explicit no-B-roll decisions: 4
- QA failures: 0
- Both previews retain video and sermon audio streams.
- B-roll video operations, when selected, require `muted: true` and render with `volume={0}`.

## Decision Evidence

The scripture-reading section is preserved as speaker-led content. The main-point section does not request a concrete illustrative asset. The application section is preserved as speaker-led content. The pressure-cooker illustration requests an image search and produces three visible ranked candidates, but all are sermon proof videos with no semantic match and `unknown` rights, so the decision is `no-suitable-asset`.

This is a successful policy outcome: a local file is not automatically considered publishable B-roll merely because it exists on disk.

## Rights Policy

- `owned` and `approved` assets may be selected automatically.
- `unknown` assets remain review-only and cannot enter an automated render.
- The proof root defaults to `unknown` rights. Rights can be configured through `V4_MEDIA_RIGHTS=owned|approved` only when the operator has actually established that policy for the configured root.

## Cache And Performance

The media index is independent from transcript and presentation hashes. It is incrementally reused by path, size, modification time, and indexer version. The first run indexed three assets; the subsequent verification run reused all three. Asset IDs use a stable full-path hash, with indexer version `director-v4-media-indexer-2` invalidating earlier IDs after that correction.

## Conditional Follow-up

Before calling this milestone a full GO, configure a small library of genuinely owned or explicitly approved illustrative images or clips, including at least one asset relevant to the pressure-cooker illustration. Re-run the same proof and verify one positive selected-media operation, its placement decision, muted audio behavior for video, and no rapid reuse across repeated intents.

The current implementation is safe to continue: it proves the negative path, keeps the renderer valid, preserves sermon audio, and leaves the positive path deterministic and auditable when approved media is supplied.
