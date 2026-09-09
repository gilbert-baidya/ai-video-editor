# AI Video Editor V1.3 — End-to-End Orchestration

## Validation labels

- **IMPLEMENTED** — code is connected in the product.
- **OFFICE-VALIDATED** — validated without installing restricted software or invoking live AI/full-sermon work.
- **PERSONAL-MAC-VALIDATION-PENDING** — requires the personal Mac's local media/AI runtimes.

## Architecture

**IMPLEMENTED · OFFICE-VALIDATED**

```text
React product UI
  -> local Node HTTP API
  -> ProductOrchestrator
  -> source / transcript / existing V1.1 Director / V1.2 review / Remotion / QA
  -> .runtime/projects/<project-id>/
```

Long-running filesystem, process, and rendering work remains in Node. React communicates only through the local HTTP boundary.

## Local API

**IMPLEMENTED · OFFICE-VALIDATED**

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Local host health |
| GET | `/api/capabilities` | Runtime capability discovery |
| GET/POST | `/api/projects` | List/create projects |
| GET | `/api/projects/:id` | Load authoritative project state |
| PUT | `/api/projects/:id/source` | Stream a local source into project storage |
| GET | `/api/projects/:id/source` | Range-stream the immutable source |
| POST | `/api/projects/:id/ingest` | Run/retry source ingestion |
| POST | `/api/projects/:id/transcribe` | Run/retry transcription |
| POST | `/api/projects/:id/analyze` | Run/retry the existing full-sermon Director |
| GET/PUT | `/api/projects/:id/review-workspace`, `/review` | Load and persist review |
| POST | `/api/projects/:id/render` | Run gated Remotion render and automatic QA |
| GET/POST | `/api/projects/:id/qa` | Read or re-aggregate QA |
| GET | `/api/projects/:id/status` | Poll project and jobs |
| GET | `/api/projects/:id/output` | Safely stream completed output |

Malformed IDs, unknown project actions, oversized JSON, and invalid methods are rejected.

## Project store

**IMPLEMENTED · OFFICE-VALIDATED**

The authoritative store uses human-readable JSON at:

```text
.runtime/projects/<project-id>/project.json
```

Each project owns `source/`, `artifacts/`, `cache/`, and `output/`. Metadata includes lifecycle stages and timestamps, errors, source fingerprint/metadata, artifact locations, review state, jobs, provider provenance, cache reuse, QA, and export metadata. Writes use a temporary file followed by atomic rename. Corrupt or unsupported metadata is rejected rather than treated as success. The runtime root is ignored.

Jobs left queued/running when the host stops are marked `interrupted` on startup. Completed upstream artifacts remain intact and retryable.

## Local upload

**IMPLEMENTED · OFFICE-VALIDATED**

The browser sends the `File` body through `XMLHttpRequest`, exposing upload progress. The host streams it to a project-scoped `.part` file while computing SHA-256, validates declared size, atomically renames it, and refuses source overwrite. Filename sanitization and root-containment checks prevent traversal. `ffprobe` metadata is added only when available.

The source is not transcoded during ingest.

## YouTube adapter

**IMPLEMENTED · OFFICE-VALIDATED boundary**

The adapter accepts HTTPS URLs only, allows exact YouTube hosts, extracts an 11-character video ID, creates a canonical watch URL, and invokes `yt-dlp` with `spawn(command, args)`—never a shell string. It reports `UNAVAILABLE` and performs no fake download when the executable is absent.

**PERSONAL-MAC-VALIDATION-PENDING:** real metadata/download, media fingerprint, and probe on a Mac where the owned downloader is already configured.

The design adapts the useful concepts from the user-owned SermonClip Studio—strict URL normalization, argument-array process execution, streaming upload, persistent jobs, and project-scoped artifacts. No code is imported from that repository at runtime, and AI Video Editor remains independently cloneable.

## Capabilities

**IMPLEMENTED · OFFICE-VALIDATED**

One endpoint reports `AVAILABLE`, `UNAVAILABLE`, `NOT_CONFIGURED`, or `DEGRADED` for Node, FFmpeg, ffprobe, Director, transcription, YouTube, and rendering. It exposes status/version details only; it never returns environment values or credentials. Missing runtimes are not installed.

## Transcript orchestration

**IMPLEMENTED · OFFICE-VALIDATED with fixture**

The stage persists the existing `TranscriptDocument`, preserving canonical text, Bengali Unicode, segment IDs, timing, source/model provenance, AI-suggested text, and human-approved text as distinct fields. A completed transcript artifact is reused on retry.

**PERSONAL-MAC-VALIDATION-PENDING:** real Bengali `whisper-cli` run using an explicitly configured `WHISPER_MODEL`.

## AI Director

**IMPLEMENTED · OFFICE-VALIDATED with provider mock**

The orchestrator calls the existing `runFullSermonDirector` path with the existing Ollama provider, chunking, cache, canonical coverage, bounded repair, fallback provenance, and reconciliation. It does not contain a second Director implementation.

Unavailable Ollama is a truthful `UNAVAILABLE` capability. A fallback-derived result retains fallback provenance and cannot pass the final render gate.

**PERSONAL-MAC-VALIDATION-PENDING:** live `qwen3:30b`.

## Job model, retry, and resume

**IMPLEMENTED · OFFICE-VALIDATED**

Every stage job records `jobId`, `projectId`, stage, status, progress, timestamps, error, message, and `cancelRequested`. The UI polls persisted project/job state. Failed Director work leaves ingest/transcript complete; retry reuses transcript and stage cache. Restart recovery marks abandoned active jobs interrupted without deleting artifacts.

## Review Workspace

**IMPLEMENTED · OFFICE-VALIDATED**

Director output is transformed through the existing Reverent Retention policy into the existing V1.2 Review Workspace contract. Provider/model/provenance, canonical context, decisions, display-text approval, and blockers are retained. Review changes and the approved plan are persisted through the host; reopening merges the authoritative host review into the workspace.

The host refuses a ready state when the submitted plan is not approved or blockers remain.

## Rendering

**IMPLEMENTED · OFFICE-VALIDATED with mocked tiny renderer**

The product action uses the existing `BanglaFoundation` Remotion composition and an approved edit plan. Gates require Director completion, 100% canonical coverage, no deterministic fallback, completed review, no blockers, and an immutable source. Render output is confined to the project output directory.

**PERSONAL-MAC-VALIDATION-PENDING:** bounded 2–5 minute real render, including selected local media.

## Final QA and export

**IMPLEMENTED · OFFICE-VALIDATED with mocked tiny renderer**

QA runs automatically after render and aggregates video, audio, Director coverage, B-roll rights, placement, Bengali graphics, and review readiness. A QA failure keeps the rendered file but leaves the project failed. Only all-pass QA marks `COMPLETED`.

Completed projects expose filename, duration, resolution, byte size, QA status, and project-relative output location. `SHOW OUTPUT` opens the app-scoped output endpoint; social publishing is intentionally absent.

## Security

**IMPLEMENTED · OFFICE-VALIDATED**

- strict project-ID validation;
- URL host/protocol/video-ID validation;
- sanitized filenames and application-root containment;
- immutable source writes;
- streaming upload and bounded JSON bodies;
- child-process arguments without shell interpolation;
- no client-selected output paths;
- no credential or `.env` disclosure;
- app-scoped source/output streaming;
- explicit errors instead of success-shaped fallbacks.

## Office-safe test results

**OFFICE-VALIDATED**

The dedicated V1.3 suite uses small in-memory/file fixtures and a mocked renderer/provider. It covers persistence, invalid IDs, path traversal, upload streaming, URL validation, unavailable YouTube, capability-driven behavior, failure/retry, cache reuse, provider provenance, review persistence, render gating, automatic QA, export metadata, and API route validation.

No Ollama, Whisper model, downloader, Docker, Homebrew package, Python environment, external app, system service, 42:40 render, or live provider was installed or invoked.

## Real runtime validation

- **Local Video E2E:** **VALIDATED** (see `docs/PERSONAL-MAC-V1-3-VALIDATION.md`)
  - Project ID: `project-62d0c127-4d44-4e28-adb0-04f832c3a964`
  - 120s source clip (`bounded-sermon-peter-120s.mp4`)
  - Streaming local ingest & source immutability
  - Real Whisper CLI transcription (`ggml-small.bin`)
  - Real Ollama `qwen3:30b` Director (18/18 canonical segments, 100% AI coverage, 0 fallback)
  - Review workspace persistence & restart/resume PASS
  - Remotion 1080p render PASS (216.42s wall-clock)
  - Automatic final QA PASS (all 7 gates)
  - Video streaming & export PASS
- **YouTube Ingestion:** **PENDING** (to be validated separately)

### BENGALI TRANSCRIPTION QUALITY NOTE

The personal-Mac proof confirmed valid Bengali Unicode/script integrity after script correction, but Unicode-script validity must not be treated as proof of semantic transcription accuracy.
Do not claim perfect transcript accuracy.
