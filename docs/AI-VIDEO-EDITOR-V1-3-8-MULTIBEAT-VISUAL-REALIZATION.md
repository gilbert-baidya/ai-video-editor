# AI Video Editor — V1.3.8 Multi-Beat Visual Realization

## Executive Summary
Version 1.3.8 introduces **Multi-Beat Visual Realization** to address the "static timeline" problem where a structurally active story section remained visually dormant because the system lacked short-horizon historical context and deterministic bounding rules.

## The Problem
In earlier versions, if a 72-second story block contained 3 distinct semantic beats, the Gemini Director would evaluate each beat independently. Lacking historical context, the model safely fell back to the default `speaker-full` for all beats. This caused the QA engine to fail `EDIT_ACTIVITY` due to static stretches exceeding 20 seconds.

## The Solution
V1.3.8 resolves this by introducing **Short-Horizon Contextual Planning** and **Deterministically Bounded Enrichment**:

### 1. Short-Horizon Planning Context
The Gemini Director is now injected with a `planningContext` object tracking visual treatment history. This forces the model to evaluate decisions in sequence, penalizing repetitive `speaker-full` outputs and encouraging pacing variation (B-roll, reframes).

### 2. Sub-Window B-Roll Allocation
B-roll decisions are no longer assumed to occupy the full 100% of a semantic section's duration. The realization layer deterministically slices a proportional window (maximum 40% duration, capped at 8 seconds, with an initial delay) for B-roll injection, ensuring the primary speaker naturally returns to anchor the narrative.

### 3. Deliberate Retention
Protected sections (e.g., altar calls, prayers, emotional ministry) strictly bypass the multi-beat pacing pressure. The orchestrator now actively defends these segments, allowing `no-change` operations and preventing forced visual activity.

### 4. Bounded Editorial Enrichment
If the initial analysis output still yields an `EDIT_ACTIVITY` failure (static stretch > 20s), the `ProductOrchestrator` traps the error and triggers a secondary `enrichEditorial` pass. The orchestrator isolates the specific untreated semantic segments and explicitly prompts the LLM to provide meaningful visual variation.

## System Workflow Updates

### Phase 1: Semantic & Visual Analysis
- `director-gemini.ts` completes the analysis with `planningContext`.

### Phase 2: Enrichment Evaluation
- `evaluateDirectorQuality` verifies the initial pacing metrics. If a stretch of > 20 seconds lacks meaningful edits, `director-enrichment.ts` triggers `GeminiDirectorProvider.enrichEditorial`.
- Only the specific lagging sections are re-evaluated, keeping semantic boundaries immutable.

### Phase 3: Realization 
- The `ProductOrchestrator` merges the finalized plan.
- The `saveReview` step converts decisions into executable Remotion operations, correctly isolating `operationBeatId` metadata.
- QA validates format integrity (respecting portrait/landscape source constraints) and edit activity.

## E2E Validation Results
- **Semantic Stability:** Pass
- **Format Integrity:** Pass (Source `1080x1920` correctly retained in `render.format`)
- **Pacing Metrics:** Pass (Meaningful Edit Count: 3, No-Change Duration: 0, Events per Minute: 2.5)

V1.3.8 concludes the foundational automation logic. The Director now actively designs visual variety without sacrificing reverence.

## Engineering Closure (full-frame B-roll, timing, media integrity, re-render)

A human review of the 72-second sermon found image B-roll rendered as a 50/50 split-screen. The closure work enforces one operation contract and removes the paths that could violate it.

### Operation contract ([src/broll-layout.ts](../src/broll-layout.ts))
| Operation | Rendered result |
|---|---|
| `speaker-full` | Pastor full-frame |
| `image-broll` | Image full-frame (blurred fill + contained foreground), Pastor picture hidden, sermon audio continuous |
| `video-broll` | Video full-frame starting at its operation start, B-roll audio muted, sermon audio continuous |
| `split-screen` | Two panes **only** when the operation is explicitly `split-screen` (or carries a V3 side placement) |
| `speaker-punch-in` | Full-frame Pastor with the existing safe zoom |

`Root.tsx` derives every frame from `resolveFrameVisuals`, so an `image-broll`/`video-broll` operation can never degrade to a split, and the Pastor `<Video>` always stays mounted so its audio never pauses.

### Review timing
`buildBrollReplacementOperation` (used by the Review Workspace) keeps the Director's approved window (for example 26.5–34.5 s inside a 10–51 s section), derives `visualType` from the chosen asset (an explicit, logged video→image conversion when needed) and validates compatibility. Readiness blocks any B-roll that is outside its semantic section, mismatched with its asset, unmuted, or an unapproved split.

### Media import integrity ([src/media-asset-validation.ts](../src/media-asset-validation.ts), [src/media-import.ts](../src/media-import.ts))
Imports and the library indexer derive format, MIME type, dimensions, size and SHA-256 from the file bytes (never from the extension or defaults), verify the managed copy by checksum, and record provenance (`originalFileName`, `importedAt`). Approved rights need a declared basis, and any basis other than `owned` needs a written note; unknown rights are never stamped as confirmed. `verifyAssetOnDisk` re-checks index entries before review approval and rendering. The indexer version was bumped so legacy entries with stale metadata are rebuilt.

### Safe re-render
`POST /api/projects/:id/rerender` (`orchestrator.rerender(projectId, reason)`) re-renders a project that already attempted a render. It requires completed ingest/transcript/director/review, a persisted approved plan that still equals the plan derived from the saved review, and realizable assets on disk. It archives the previous output, records a `renderRevisions` entry (reason, previous stage records and QA status), reopens only the render and QA stages, and then runs the normal render stage. The approved plan and review are never edited, and no stage status is assigned by hand.

### QA
Editorial QA now rejects missing/incompatible assets, invalid timing, overlaps, unmuted B-roll, accidental split-screen and dropped operations. Final QA derives `video`/`audio` from the real encode (ffprobe streams, exact output dimensions, duration) and measures sermon-audio continuity inside every B-roll window against the untouched source with ffmpeg `volumedetect`.

### Validation status
Deterministic suites: `test-broll-layout-v1-3-8`, `test-broll-review-timing-v1-3-8`, `test-media-import-v1-3-8`, `test-media-integrity-v1-3-8`, `test-safe-rerender-v1-3-8`, `test-multibeat-visual-realization-v1-3-8`. These do not prove real-media rendering; a real-video render and visual inspection must still be performed on the machine holding the sermon source.

### Closure corrections

**`sourceStart`/`sourceEnd` semantics.** On a `broll` operation these are the *canonical sermon-source* range the B-roll covers (mapped to the composition by the preview window). They are not an in-point into the B-roll asset. The renderer ignores them: `start`/`end` place the clip on the composition timeline, and a video asset always plays from its own beginning at `start` (inside a `Sequence`, looping if shorter). `buildBrollReplacementOperation` therefore keeps the approved composition window and an existing operation's source mapping, and a test asserts that the renderer never seeks using source timing.

**Replacing an asset on a finished project.** The supported sequence is: import asset → replace in Review → save Review → run the normal **render** stage (`POST /api/projects/:id/render`).
- Saving a Review that approves a plan different from the one last rendered archives the previous output, records a `renderRevisions` entry, clears the stale QA/output evidence and reopens render/QA. The normal state machine then moves the project to `READY_TO_RENDER`.
- Saving a Review that yields the *same* plan as the last render (`lastRenderedPlanHash`) leaves the completed outcome untouched.
- `POST /api/projects/:id/rerender` is only for re-rendering an *unchanged* approved plan (for example after a renderer fix). After a plan-changing Review save it correctly refuses and points to the normal render stage.

**Real-video validation frames (current validation project plan).** The persisted Approved Plan has image B-roll 0–10 s and 26.5–34.5 s and a Pastor punch-in 51–72 s. The Approved Plan must not be changed to suit the check. Expected frames:

| Time | Expected |
|---|---|
| 5 s | Full-frame B-roll (no Pastor picture, no split) |
| 30 s | Full-frame B-roll |
| 45 s | Pastor full-frame |
| 60 s | Pastor punch-in |

Sermon audio must be continuous throughout, including during both B-roll windows. These expectations are covered deterministically by `test-replacement-workflow-v1-3-8`; the real render still has to be inspected on the machine holding the sermon.
