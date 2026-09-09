# Personal Mac V1.3 Validation

Status: **LOCAL-VIDEO-VALIDATED · YOUTUBE-PENDING**

## Real Local-Video E2E Validation Result (2026-09-09)

- **Status:** **VALIDATED** (Local-Video End-to-End Workflow)
- **Project ID:** `project-62d0c127-4d44-4e28-adb0-04f832c3a964`
- **Source:** 120s bounded sermon clip (`.runtime/test-sources/bounded-sermon-peter-120s.mp4`, 33,938,930 bytes, SHA-256: `2686f692f1225d4732a6fbdf76e730e92176503314833b2e3cc382cbdad82b9e`)
- **Ingestion:** Streaming `PUT /api/projects/:id/source`, zero memory buffering, immutable source protection (HTTP 409 on overwrite attempt)
- **Transcription:** Real `whisper-cli` with `ggml-small.bin` (26.59s wall-clock). Script-corrected to native Bengali Unicode (`0x0980..0x09FF`), 18 monotonic segments (0–95s).
- **AI Director:** Real live Ollama `qwen3:30b` (19.56s runtime). 18/18 primary canonical segments covered (100% AI coverage), zero deterministic gap-fill, `fallbackUsed: false`, pure AI provenance.
- **Review Workspace:** Real human decision persistence via `PUT /api/projects/:id/review` (accept, keep-pastor, approve-text, revert tested; approved Bengali text and safe speaker-led state retained).
- **Restart / Resume:** PASS. Host stopped and restarted on port 4174; project state preserved as `READY_TO_RENDER`; upstream ingest, transcript, and director stages were not re-executed.
- **Render:** PASS. Remotion bundled composition `BanglaFoundation` and rendered 3,600 frames (120.0s @ 30 fps, 1920x1080 H.264 / AAC 48kHz) in 216.42s wall-clock. Output size: 90,771,766 bytes (~90.77 MB).
- **Final QA:** PASS. Automatic post-render QA passed all 7 gates (`video`, `audio`, `directorCoverage`, `brollRights`, `placement`, `bengaliGraphics`, `reviewReadiness`). Final project status: `COMPLETED`.
- **Export:** PASS. Output verified via ffprobe and streamed over `GET /api/projects/:id/output` with byte-range support (HTTP 206 Partial Content).

### BENGALI TRANSCRIPTION QUALITY NOTE

The personal-Mac proof confirmed valid Bengali Unicode/script integrity after script correction, but Unicode-script validity must not be treated as proof of semantic transcription accuracy.
Do not claim perfect transcript accuracy.


## Preconditions

1. Use the authoritative AI Video Editor repository.
2. Confirm the personal Mac's existing FFmpeg, ffprobe, Whisper, model, Ollama, `qwen3:30b`, and optional `yt-dlp` setup independently.
3. Set `WHISPER_MODEL` to the repository-relative model path.
4. Run `npm run dev:product`.
5. Open `http://127.0.0.1:4173` and record `/api/capabilities`.

Do not install or reconfigure those tools as part of this checklist.

## A. Fresh local-video project

1. Create a uniquely titled project.
2. Select a 2–5 minute local sermon video.
3. Confirm visible upload progress.
4. Confirm the project records size, SHA-256, duration, and dimensions.
5. Reload the browser and confirm the project/source remain available.

Pass: the source streams from the project endpoint, is immutable, and no browser fake path is stored.

## B. Fresh YouTube project, if capability exists

1. Use a rights-cleared HTTPS YouTube watch or short URL.
2. Confirm canonical video ID/URL.
3. Run ingest.
4. Confirm a real project-scoped media file, SHA-256, probe metadata, and provider details.

If YouTube capability is unavailable, record that truthful state and skip; do not manufacture a source.

## C. Real transcript

1. Run **TRANSCRIBE**.
2. Inspect `artifacts/transcript.json`.
3. Confirm Bengali Unicode/graphemes, segment IDs, monotonic timing, provider/model provenance, and immutable canonical original text.
4. Retry and confirm the persisted artifact is reused.

## D. Live qwen3:30b

1. Confirm Director capability is `AVAILABLE`.
2. Run **ANALYZE SERMON**.
3. Confirm live Ollama/qwen3:30b provenance, complete canonical coverage, bounded repair evidence, and no deterministic gap fill.
4. Restart the host during a separate disposable run; confirm the abandoned job becomes interrupted and can be retried.

## E. Director review

1. Open the generated Review Workspace.
2. Exercise ACCEPT, REJECT, KEEP PASTOR, EDIT DISPLAY TEXT, APPROVE TEXT, and REVERT.
3. Resolve Scripture, rights, placement, and text blockers.
4. Reload the browser and restart the host.
5. Confirm the authoritative review and approved plan reload.

## F. Restart/resume

1. Stop the host after transcript and Director completion.
2. Start it again with `npm run dev:product`.
3. Confirm completed stages/artifacts remain complete.
4. Retry only the next failed/interrupted stage.
5. Confirm ingest/transcript are not repeated.

## G. Bounded render

1. Use the approved 2–5 minute project.
2. Confirm all render blockers are clear.
3. Run **RENDER SERMON**.
4. Confirm Remotion uses the immutable source and approved plan.
5. Confirm output is H.264 with AAC and remains inside the project output directory.

Do not proceed to a full-sermon render until this bounded result passes.

## H. Final QA

Confirm QA runs automatically and records:

- video;
- audio;
- Director coverage;
- B-roll rights;
- placement;
- Bengali graphics;
- review readiness.

Create one controlled QA failure if practical and confirm the rendered file remains while the project does not become `COMPLETED`.

## I. Output/export

1. Confirm `COMPLETED` appears only after all required QA checks pass.
2. Confirm filename, duration, resolution, file size, QA status, and output location.
3. Use **SHOW OUTPUT** and verify it exposes only the app-managed output.
4. Confirm no social publishing controls exist.

## Evidence to retain

Retain the capability response, project metadata, transcript provenance, Director provenance/coverage, review state, approved plan, render metadata, QA record, and a short written result for each section above. Keep sermon media and runtime data out of version control.
