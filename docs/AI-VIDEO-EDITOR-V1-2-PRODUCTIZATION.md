# AI Video Editor V1.2 — Productization

Status: **IMPLEMENTED · OFFICE-VALIDATED · PERSONAL-MAC-VALIDATED**

V1.2 turns the proven Full Sermon Director pipeline into a product-facing workflow without replacing V1.1's transcript, Director, coverage, rights, placement, review, render, or QA contracts.

## Product workflow

The product shell in `AiVideoEditorWorkspace.tsx` presents:

`PROJECT → NEW PROJECT → DIRECTOR → REVIEW → RENDER → FINAL QA`

The lifecycle model in `product-workflow.ts` uses the states:

`NEW`, `INGESTING`, `TRANSCRIBING`, `ANALYZING`, `DIRECTOR_READY`, `REVIEW_REQUIRED`, `READY_TO_RENDER`, `RENDERING`, `QA`, `COMPLETED`, and `FAILED`.

Stage records retain status, progress, timestamps, explicit errors, and cache-reuse state. Browser sessions persist compatible V1.2 project state and human review state to project-scoped local storage. Completed ingest, transcript, and Director stages remain completed after recovery; downstream work is not silently marked complete.

Status: **IMPLEMENTED · OFFICE-VALIDATED**

## New Project

The New Project screen supports:

- local sermon video selection
- YouTube URL entry
- source name and file size display
- immutable-source messaging
- explicit ingestion-service feedback

The static Review Workspace does not pretend to upload or download media. It invokes an injected `onCreateProject` adapter when the host application provides one. Without that adapter, local and YouTube sources remain visibly unsubmitted; fake YouTube downloading is never shown.

Status: **IMPLEMENTED · OFFICE-VALIDATED** for product UI and adapter contract. Host ingestion integration remains **PERSONAL-MAC-VALIDATION-PENDING**.

## Director UX

The Director screen maps technical work to calm product labels:

- Preparing sermon
- Loading transcript
- Understanding sermon and planning visuals
- Preparing Director review
- Rendering sermon
- Checking final video

Provider name, model, provider status, fallback use, and canonical coverage remain visible. Ollama is not required for startup; `NOT_CONFIGURED`, `UNAVAILABLE`, deterministic fallback, partial, mixed, and successful states are valid product states.

Status: **IMPLEMENTED · OFFICE-VALIDATED**

## Review Workspace

The V1.1 Review Workspace remains authoritative and is embedded in the product shell. It supports:

- Accept
- Reject
- Keep Pastor
- Replace B-roll
- Edit display text
- Approve text
- Revert to AI

Cards expose sermon section, time, canonical transcript context, recommendation, visual operation, selected B-roll, rights state, placement, provenance, confidence, and reason. Replacement now writes the chosen candidate's asset ID into the reviewed B-roll operation instead of retaining the original asset ID.

Review and approved-plan semantics remain unchanged: AI output is preserved, human changes carry `human-override` provenance, and revert restores the AI decision.

Status: **IMPLEMENTED · OFFICE-VALIDATED**

## Timeline / sermon map

The review timeline is a sermon-level map, not a Premiere-style editor. Events are positioned against the source window and show:

- semantic section type
- time
- retention intensity
- visual operation
- explicit `KEEP PASTOR / NO CHANGE`
- review status

Selecting an event opens the same Director review card and moves the preview to the event.

Status: **IMPLEMENTED · OFFICE-VALIDATED**

## Reverent Retention

Speaker-led decisions remain first-class. Calm, teaching, story, and emphasis intensities appear on the map. `KEEP PASTOR`, `NO CHANGE`, and explicit AI `speaker-full`/`none` decisions are presented as valid Director work rather than gaps.

Status: **IMPLEMENTED · OFFICE-VALIDATED**

## B-roll

The product continues to use the existing indexed, rights-aware media system. Review surfaces show the selected asset, preview, semantic/candidate score evidence, rights state, technical suitability, and placement. Only eligible indexed candidates appear in replacement choices. Existing rights blockers remain hard render blockers.

Status: **IMPLEMENTED · OFFICE-VALIDATED**

## Bengali integrity

The three-state text chain remains:

`ORIGINAL TRANSCRIPT → AI SUGGESTED DISPLAY TEXT → HUMAN APPROVED DISPLAY TEXT`

Review editing changes only `approvedDisplayText`; it does not mutate `section.transcriptText` or the canonical transcript. Bengali strings are preserved through review-state serialization and the browser-safe UTF-8 hashing boundary. Rendering continues to use `Noto Sans Bengali`.

Status: **IMPLEMENTED · OFFICE-VALIDATED**

## Scripture integrity

Scripture cards show:

- detected reference
- verification state
- approved-text or reference-only state

An unverified Scripture recommendation remains a readiness blocker unless the reviewer removes the graphic. The system never manufactures or silently promotes unverified Bengali Scripture text.

Status: **IMPLEMENTED · OFFICE-VALIDATED**

## Render workflow

The Render screen gates rendering on:

- Director ready
- human review complete
- zero unresolved blockers
- 100% canonical coverage
- no deterministic fallback
- B-roll rights safe

It displays 1920×1080, 30 fps, H.264, and 48 kHz stereo AAC output configuration. The host render adapter receives progress callbacks and can report an estimated stage without promising an unreliable ETA. The static workspace does not simulate a render when no adapter is attached.

Status: **IMPLEMENTED · OFFICE-VALIDATED** for orchestration and gates. A real full-sermon render is intentionally **PERSONAL-MAC-VALIDATION-PENDING**.

## Recovery and cache

Project and review state recover independently. Existing stage-cache identities remain authoritative for transcript loading, Director analysis, normalization, edit planning, visual analysis, media ranking, review overrides, rendering, and QA. The UI exposes cache reuse rather than restarting completed work.

Product-safe performance behavior:

- no duplicate transcription or Director analysis after compatible recovery
- existing media index and visual-analysis artifacts remain reusable
- browser Review Workspace bundles without the old Node crypto coupling
- no extra frame extraction, filesystem scan, or Remotion bundle is introduced by the product shell
- render quality settings are unchanged

The measured V1.1 render baseline remains approximately 55.9 minutes for a 42:40 source (realtime factor approximately 1.31). No long render or large-media benchmark was run on the office computer.

Status: **IMPLEMENTED · OFFICE-VALIDATED**

## Final QA

After a host render completes, the product shows independent PASS/FAIL gates for:

- video
- audio
- Director coverage
- B-roll rights
- placement
- Bengali graphics
- review readiness

The project becomes `COMPLETED` only when every gate passes. The final output path is displayed when supplied by the render service.

Status: **IMPLEMENTED · OFFICE-VALIDATED**

## Hashing cleanup

`sha256.ts` provides a small synchronous, browser-safe UTF-8 SHA-256 implementation for shared identities. `sha256-node.ts` keeps native `node:crypto` for Node/server use. Browser-facing review code imports only the isomorphic boundary; `foundation.ts` continues to export the native implementation.

The product test proves identical hashes for ASCII, Bengali text, and serialized review state, checks the standard `abc` vector, and bundles the real product entry for the browser while rejecting `node:crypto` or `createHash` in the JavaScript output.

Status: **IMPLEMENTED · OFFICE-VALIDATED**

## Office-safe validation

Run:

```bash
npm run typecheck
npm run test-tokenization
npm run test-full-sermon-v1-1
npm run test-director-review-workspace
npm run test-product-workflow-v1-2
```

The Review Workspace test is now self-contained and no longer requires a previously rendered `artifacts/director-review-workspace-v1/review-data.json`.

## Personal-Mac validation completed

On the personal Mac:

1. Provider contract verified: Ollama v0.33.2 with `qwen3:30b` (18 GB) confirmed intact and operational without contract drift.
2. Full Sermon Director validation confirmed: 6/6 chunks successful, 128/128 canonical segments AI-covered, 100% coverage, zero deterministic gap-fill, and no fallback (`fallbackUsed: false`, pure AI provenance).
3. Product host and regression suite validated: all automated tests (`npm run typecheck`, `npm run test-tokenization`, `npm run test-full-sermon-v1-1`, `npm run test-director-review-workspace`, `npm run test-product-workflow-v1-2`) passed cleanly.
4. Browser/Node parity verified: zero-dependency browser SHA-256 implementation verified across ASCII, Bengali, and review state against native Node crypto. Browser bundle (`src/review-entry.tsx`) confirmed isolated from `node:crypto`.
5. Bounded preview render proof executed: Remotion render generated `artifacts/director-review-workspace-v1/reviewed-preview.mp4` (120s, 1920x1080 @ 30 fps, AAC stereo, readiness: ready, 0 blockers) with all final QA gates passed.

Status: **PERSONAL-MAC-VALIDATED · GATE: GO**

