# Personal Mac V1.1 Validation

Use this procedure only on the personal Mac where the existing local AI runtime and licensed/private media are intentionally available. Do not copy credentials into the repository.

## 1. Update the repository

```bash
cd ~/Projects/ai-video-editor
git status --short --branch
git fetch origin
git switch feat/full-sermon-pilot-v1-1-provider-abstraction
git pull --ff-only
npm install
```

Stop before pulling if `git status` reports local changes that you did not intend to preserve on this branch.

## 2. Required local assets

These files are intentionally not supplied by Git:

- `artifacts/full-sermon-pilot-v1/transcript.json`
- `artifacts/full-sermon-pilot-v1/analysis/sermon-analysis.json`
- `artifacts/full-sermon-pilot-v1/cache.json`
- `artifacts/full-sermon-pilot-v1/media-index/index.json`
- `public/full-sermon-pilot-source.mp4`
- Any approved local B-roll referenced by the media index

The canonical transcript and source must correspond to SermonClip project `GOLDEN-E2E---Intervention-Sermon-2`. Preserve the source and canonical segment IDs; do not retranscribe merely to run this validation.

Before continuing:

```bash
test -f artifacts/full-sermon-pilot-v1/transcript.json
test -f artifacts/full-sermon-pilot-v1/analysis/sermon-analysis.json
test -f artifacts/full-sermon-pilot-v1/cache.json
test -f artifacts/full-sermon-pilot-v1/media-index/index.json
test -f public/full-sermon-pilot-source.mp4
```

## 3. Local AI provider

Expected provider and model:

```text
Provider: Ollama
Model: qwen3:30b
Default endpoint: http://127.0.0.1:11434
```

Verify the personal Mac's existing installation:

```bash
ollama --version
ollama list
```

The model name reported by `ollama list` must match `qwen3:30b`, or set `SERMON_DIRECTOR_MODEL` to the exact installed tag. This document does not include model installation instructions because model acquisition is outside the office-safe milestone.

## 4. Office-safe regression checks

```bash
npm run typecheck
npm run test-tokenization
npm run test-full-sermon-v1-1
```

All three commands must pass before live inference.

## 5. Run the live AI Director

```bash
SERMON_DIRECTOR_PROVIDER=auto \
SERMON_DIRECTOR_MODEL=qwen3:30b \
OLLAMA_HOST=http://127.0.0.1:11434 \
npm run prove-full-sermon-live-ai
```

Expected console state:

```text
providerStatus: AVAILABLE
fallbackUsed: false
allChunksLive: true
fallbackChunkCount: 0
```

If fallback is reported, do not describe the result as live AI. Inspect `artifacts/full-sermon-pilot-v1-1/analysis/provider-probe.json` and resolve the provider/model issue before rendering.

## 6. Compare AI with deterministic fallback

The live proof automatically writes:

```text
artifacts/full-sermon-pilot-v1-1/analysis/ai-vs-fallback.json
```

The reusable harness can also compare stored result pairs:

```bash
npm run compare-directors -- \
  artifacts/full-sermon-pilot-v1/analysis/sermon-analysis.json \
  artifacts/full-sermon-pilot-v1-1/analysis/fallback-provenance.json \
  artifacts/full-sermon-pilot-v1-1/analysis/sermon-analysis.json \
  artifacts/full-sermon-pilot-v1-1/analysis/director-provenance.json \
  artifacts/full-sermon-pilot-v1-1/analysis/manual-ai-vs-fallback.json \
  2560
```

Use provenance files that match `DirectorExecutionProvenance`. The automatic comparison from the live proof is authoritative when these standalone provenance files have not been exported.

Review beat count, visual events, events/minute, Scripture and story activity, no-change decisions, B-roll/graphic/layout decisions, rejected unsafe decisions, schema validity, canonical range validity, runtime, and fallback status.

## 7. Run the bounded and full-sermon proof

This command performs rendering and must run only after the live result reports no fallback:

```bash
npm run prove-full-sermon-pilot-v1-1
```

Do not bypass the fallback-free gate. The proof validates Reverent Retention, Scripture and display-text review gates, rights-safe B-roll, V3 placement, Review Workspace persistence, bounded preview QA, and final media QA.

For the separate five-minute performance comparison:

```bash
npm run benchmark-full-sermon-render
```

## 8. Expected output

Analysis and provenance:

- `artifacts/full-sermon-pilot-v1-1/analysis/live-ai-result.json`
- `artifacts/full-sermon-pilot-v1-1/analysis/provider-probe.json`
- `artifacts/full-sermon-pilot-v1-1/analysis/fallback-provenance.json`
- `artifacts/full-sermon-pilot-v1-1/analysis/director-provenance.json`
- `artifacts/full-sermon-pilot-v1-1/analysis/chunks.json`
- `artifacts/full-sermon-pilot-v1-1/analysis/global-merge.json`
- `artifacts/full-sermon-pilot-v1-1/analysis/sermon-analysis.json`
- `artifacts/full-sermon-pilot-v1-1/analysis/ai-vs-fallback.json`

Review and QA:

- `artifacts/full-sermon-pilot-v1-1/review/director-review.json`
- `artifacts/full-sermon-pilot-v1-1/review/approved-edit-plan.json`
- `artifacts/full-sermon-pilot-v1-1/review/readiness.json`
- `artifacts/full-sermon-pilot-v1-1/bounded/qa.json`
- `artifacts/full-sermon-pilot-v1-1/final-qa.json`

Performance and render:

- `artifacts/full-sermon-pilot-v1-1/performance/benchmark.json`
- `artifacts/full-sermon-pilot-v1-1/full-render-timing.json`
- `artifacts/full-sermon-pilot-v1-1/full-sermon-live-ai-reviewed.mp4`

## 9. Return these results

Send back:

- Complete console output from the three regression checks
- `provider-probe.json`
- `chunks.json`
- `global-merge.json`
- `ai-vs-fallback.json`
- `readiness.json`
- `bounded/qa.json`
- `final-qa.json`
- `performance/benchmark.json`
- `full-render-timing.json`
- Any failed chunk ID, provider error, schema error, canonical-range error, review blocker, or QA failure

Do not send source video, private B-roll, credentials, model files, or unrelated SermonClip project data.
