# Sol Foundation Fixes Report

Date: 2026-09-07  
Branch: `fix/sol-foundation-review`  
Scope: bounded `FIX NOW` corrections before Director V4.1

## Source Review

The controlling document was [SOL-FOUNDATION-ARCHITECTURE-REVIEW.md](SOL-FOUNDATION-ARCHITECTURE-REVIEW.md). This milestone implemented the P0/P1 `FIX NOW` findings F-01 through F-11, F-16, and the targeted regression coverage in F-22. It did not redesign the Director, Reverent Retention, Visual Intelligence, Edit Plan, Remotion, transcription, or media-library architecture.

No V4.1 positive asset was added. No stock API, download, embedding service, media browser, paid API, deployment, or publication work was introduced. `sermonclip-studio/` and `research/` remained read-only.

The requested branch exists. The repository still has no initial commit and all project files are untracked, so Git cannot provide commit-based rollback or a historical diff; the branch preserves the current unborn working tree but does not replace a real baseline commit.

## Fixes

| Finding ID | Problem | Code changed | Test/evidence | Status |
| --- | --- | --- | --- | --- |
| F-01 | Cached approval could survive rights-policy or indexer changes; one policy covered every root | Added root policy version and asset rights provenance; reuse now requires matching persisted indexer version, root ID, policy version, rights status, and rights source; proof/public roots have independent configuration | `prove-sol-foundation-fixes`: approved-to-unknown reused 0, unknown-to-approved reused 0, stable approved reused 1, obsolete indexer reused 0 | FIXED |
| F-02 | V4 bypassed Reverent Retention and V3 placement | V4 now applies retention decisions before selection and resolves every selected operation through the existing V3 safe-zone scorer | Focused proof confirms calm B-roll suppression and rejects a selected operation without V3 placement | FIXED |
| F-03 | Semantic operations could lie outside the rendered preview and still appear successful | Added canonical source-to-preview mapping; Edit Plan B-roll stores source and preview-relative ranges; V4 extracts the matching source window; QA requires intersection, positive duration, in-composition bounds, plan inclusion, render completion, and frame-difference evidence | Focused proof maps 100–120 to 20–40 in an 80–200 window and rejects 260–340; V4 metadata records 240–360 to 0–120 | FIXED |
| F-04 | ASCII-only media terms blocked Bangla filenames and metadata | Added NFC, Unicode letter/mark/number tokenization and separate `searchTerms`; exact Bangla scoring now normalizes against the actual bounded query size | Bangla-only `বাইবেল.mp4` is selected by `বাইবেল`; multilingual tags retain original text; English `scripture` still matches | FIXED |
| F-05 | AI display text and unverified Scripture could reach rendering without meaningful trust state | Added explicit display trust states and preview/final policy; preview suggestions remain unapproved; final mode uses approved or canonical text; unverified Scripture renders reference only | Focused proof records preview `ai-suggested-unapproved`, V3 operation unchanged, final `canonical-transcript`, Scripture `scripture-reference-needs-review` | FIXED |
| F-06 | Provider fallback could contain no usable analysis | Provider fallback now returns deterministic, segment-safe speaker-full analysis | Focused unreachable-endpoint test returns `deterministic-fallback` with non-empty analysis | FIXED |
| F-07 | Director could analyze segments different from its hashed transcript | Added exact project, count, ID, text, and timing checks against canonical transcript segments | Focused mismatch test is rejected | FIXED |
| F-08 | V3 sampled global 1/30/59 second frames for every beat | Added versioned beat-relative start/midpoint/end sampling with legal media bounds | Unit proof: beat 20–40 yields 20/30/40; real V3 artifact: beat 40–80 yields 40/60/80 | FIXED |
| F-09 | Resolved V3 font size was discarded by Remotion | Renderer now reads `operation.placement.textFit.fontSize`, with the existing prop as fallback | Focused renderer helper proof resolves 44 instead of fallback 62; V3 text-fit QA passes | FIXED |
| F-10 | Transcript integrity was proof-only and Director input could bypass canonical source | General QA and Director input now call the existing integrity measurement; unapproved review/fail input is rejected unless explicitly hybrid-reviewed | Existing integrity proof retains canonical Bengali PASS and rejects malformed ASR candidates for review | FIXED |
| F-11 | Plans could claim validated before checks; pre-render QA could claim top-level pass before render | Retention and V4 plans begin as draft and become validated only after focused checks; pre-render QA top-level result remains false until render QA is complete | Typecheck and focused QA assertion pass; V2/V3/V4 proof QA passes | FIXED |
| F-16 | Missing detector evidence could silently trigger visual fallback | V3 graphics return `review` without frames; B-roll placement also returns `review`; validation requires evidence | Focused proof returns review for missing B-roll frames and rejects placement bypass | FIXED |
| F-22 | Critical negative paths lacked executable regressions | Added `prove-sol-foundation-fixes` covering rights, Unicode search, timing, placement, visibility, text fit, trust, fallback, canonical input, overlap, and QA state | `artifacts/sol-foundation-fixes/regression-proof.json`: PASS | FIXED |

## Rights Cache

The media indexer is now `director-v4-media-indexer-3`. Each root supplies a stable ID, independent rights status, and `rightsPolicyVersion`. Each asset persists:

- `rightsStatus`
- `rightsSource: library-root-default`
- `libraryRootId`
- `libraryPolicyVersion`

An unchanged file is reusable only when file stats, persisted indexer version, root identity, policy version, rights status, and rights source all match.

The deterministic downgrade proof produced:

- approved → unknown: `reused = 0`, resulting status `unknown`
- unknown → approved: `reused = 0`, resulting status `approved`
- approved → same approved policy: `reused = 1`
- obsolete indexer → current indexer: `reused = 0`
- unknown-rights automatic selection: rejected

The real V4 proof keeps both configured roots at `unknown`. It indexed four assets and selected none.

## Bangla Search

Original filenames, tags, categories, and descriptions remain intact. A separate normalized `searchTerms` array is generated using NFC and Unicode letter, combining-mark, and number classes.

The proof preserves these terms without damage:

`প্রার্থনা`, `বাইবেল`, `বিশ্বাস`, `বাংলাদেশ`, `পরিবার`, `গির্জা`, `উপাসনা`, `প্রকৃতি`, `মিশন`, `অনুগ্রহ`

A Bangla-only filename `বাইবেল.mp4` meaningfully matches and becomes eligible under approved proof rights. A separate multilingual asset with `Bible`, `বাইবেল`, and `Scripture` also matches the English query `scripture`.

This remains deterministic normalized metadata matching with the existing small synonym expansion. It is not an embedding or broad semantic-search claim.

## V4 Preview Mapping

The mapping contract preserves canonical timing while deriving preview timing:

- `sourceStart` / `sourceEnd`: original semantic fixture coordinates
- `start` / `end`: preview-relative Remotion coordinates
- visible intersection is clipped to the selected preview window

The real V4 proof now selects semantic fixture range 240–360 seconds and extracts the matching absolute sermon range 4240–4360 seconds into a 0–120 second composition. The previously problematic 260–340 second illustration therefore maps to 20–100 seconds when selected.

Hard QA rejects a selected decision when it:

- does not intersect the preview
- has zero visible duration
- falls outside the composition
- loses canonical source timing
- references a missing, unusable, or non-automatable asset
- lacks an authorized V3 placement
- is absent from the render plan
- lacks render completion evidence
- lacks a control-versus-director frame difference

The focused negative proof confirms an out-of-window selection and a selection without visible frame evidence both fail.

## V3 Placement

The V4 sequence is now:

`B-roll intent → Reverent Retention → media selection → V3 frame analysis → V3 placement → Edit Plan → Remotion → visibility QA`

The existing safe-zone scorer resolves selected media to `split-left`, `split-right`, or a genuine `full-screen` fallback. Review/suppressed placement produces no B-roll operation. Persisted placement evidence contains the intent, selected asset, retention record, analyzed frames, candidate scores, final placement, and reason.

The focused proof confirms calm B-roll is suppressed and that no operation can be constructed without a V3 placement decision.

## Frame Sampling

`representativeSampleTimes()` derives legal beat-relative start, midpoint, and end samples.

- Deterministic case: beat 20–40 → 20, 30, 40
- Real V3 case: beat 40–80 → 40, 60, 80
- Version: `beat-relative-sampling-v2`

The V3 cache artifact also records `safe-zone-placement-v2` and `bangla-text-fit-v2`. V4 records those versions plus `source-preview-mapping-v1` and the retention-policy hash. A focused hash mutation proves a sampling-version change changes the visual cache key; transcript inputs are not part of media-file metadata reuse.

## Text Fit

`PlacementDecision.textFit.fontSize` now reaches Remotion for both sermon-point and full-screen-card operations. The existing `graphicFontSize` remains only the fallback.

The focused proof supplies a resolved size of 44 with a fallback of 62 and confirms the renderer resolves 44. The real V3 proof reports `textFit: true`.

## Trust Gates

Display text uses explicit provenance:

- `canonical-transcript`
- `ai-suggested-unapproved`
- `approved-display`
- `scripture-reference-needs-review`
- `verified-scripture`

Preview mode may display AI suggestions but marks them unapproved throughout V2 and V3 operation rewriting. Final mode requires explicit per-section approval or falls back to canonical transcript text. It never silently promotes a suggestion.

For Scripture cards:

- verified metadata may render the verified display text
- `needs-review` renders the reference only and records a warning
- unverified verse-like suggested text is withheld

No Scripture retrieval or fabrication was added.

Director input must match the configured canonical transcript exactly. Existing integrity measurement now gates unapproved non-reviewed input in both Director input validation and general QA. ASR research was not reopened.

## Regression

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm run test-tokenization` | PASS; Bengali grapheme fixtures undamaged |
| `npm run prove-sol-foundation-fixes` | PASS; all targeted positive and negative assertions |
| `DIRECTOR_RUNS=1 npm run prove-director-hardening` | PASS; real `qwen3:30b`, parse/schema/segment/semantic success |
| `npm run prove-director-v2-preview` | PASS; preview warning records unapproved AI text |
| `npm run prove-director-v3-visual-intelligence` | PASS; three beat-relative frames, placement/text-fit/title-safe/face checks pass |
| `npm run prove-director-v4-local-broll` | PASS; four assets indexed, zero selected, four no-B-roll/no-suitable decisions, no QA failures |
| `npm run prove-transcript-integrity` | Expected CONDITIONAL GO; canonical Bengali source PASS, malformed ASR candidates REVIEW |

The final metadata-only trust propagation correction after the full V3 run was covered by the final typecheck and focused V3-operation assertion. No expensive unrelated foundation/ASR/render pipeline was rerun.

## Remaining FIX LATER Items

The review's P2/P3 work remains intentionally unimplemented:

- durable discriminated persistence unions
- general executable stage-cache DAG
- retry/checkpoint/cancellation job orchestration
- long-form dynamic composition and measured 35–40 minute run
- complete semantic intent and punch-in mappings
- full-sermon retention repetition/event-budget refinements
- grapheme/font-metric typography refinement
- mixed-language sentence-period refinement
- video B-roll duration and operation-relative playback validation
- configurable tool paths, process timeouts, and path sandboxing
- deployment licensing inventory

V4.1 positive selection also remains unimplemented. The proof library is still empty of a claimed owned/approved illustrative asset.

## Recommendation

Recommendation: **READY FOR V4.1**

The pre-V4.1 trust, rights-cache, Bangla metadata, preview mapping, V3 placement, frame sampling, text-fit, canonical transcript, and negative QA blockers are corrected and covered by passing regressions. V4.1 should now add exactly one genuinely owned/approved illustrative asset and exercise the already-enforced positive render-visibility path; it should not alter this architecture.
