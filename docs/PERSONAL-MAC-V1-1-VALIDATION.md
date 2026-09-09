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
providerStatus: SUCCESS
fallbackUsed: false
allChunksLive: true
fallbackChunkCount: 0
chunks: 6 (or the actual resulting count)
primaryCanonicalSegmentCount: <all canonical segments>
aiCoveredPrimarySegmentCount: <equal to primaryCanonicalSegmentCount>
deterministicGapFilledSegmentCount: 0
coveragePercent: 100
canonicalCoverageComplete: true
```

`coverageRepairAttempts` may be non-zero. A bounded repair is a legitimate path to complete coverage, but `coverageRepairSuccesses` must then be non-zero and coverage must still end at 100%.

If fallback is reported, do not describe the result as live AI. Inspect `artifacts/full-sermon-pilot-v1-1/analysis/provider-probe.json` and resolve the provider/model issue before rendering.

### 5a. Coverage validation gate

```bash
cat artifacts/full-sermon-pilot-v1-1/analysis/canonical-coverage.json
cat artifacts/full-sermon-pilot-v1-1/analysis/provider-probe.json
```

Every condition below must hold before continuing:

- the reported chunk count matches the run (six, or the actual resulting count)
- provider success count equals provider chunk count
- `schemaValidation: PASS`
- `canonicalRangeValidation: PASS`
- `canonicalCoverageValidation: PASS`
- `canonicalCoverageComplete: true`
- `coveragePercent: 100`
- `deterministicGapFilledSegmentCount: 0`
- `fallbackUsed: false`

STOP before full rendering if any condition fails. `report.missingPrimaryIds` and `report.missingRanges` identify exactly which canonical segments the model left uncovered.

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

Review beat count, visual events, events/minute, Scripture and story activity, no-change decisions, B-roll/graphic/layout decisions, rejected unsafe decisions, schema validity, canonical range validity, canonical coverage completeness, primary canonical segment count, AI-covered primary segment count, deterministic gap-filled segment count, coverage percent, coverage repair attempts and successes, provider chunk and success counts, provenance, runtime, and fallback status.

For a successful pure-AI run the `ai` side must report `coveragePercent: 100`, `deterministicGapFilledSegmentCount: 0`, `canonicalCoverageComplete: true`, `provenance: ai`, and `fallbackUsed: false`.

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

## 10. Completed production validation record

Conducted on Personal Mac (Apple Silicon, 18 logical CPUs, 64 GB RAM):

- **Lightweight tests**: `typecheck: PASS`, `test-tokenization: PASS`, `test-full-sermon-v1-1: PASS`, `test-director-review-workspace: PASS`
- **Live AI Director**: Ollama 0.33.2 / `qwen3:30b`, 6/6 chunks, 128/128 primary segments, 100% coverage, zero deterministic gap-fill, fallbackUsed: false, pure AI provenance
- **AI vs Fallback**: 85 AI beats vs 13 fallback beats, 16 AI visual events vs 3 fallback visual events, 69 AI no-change decisions
- **Bounded Previews**: `bounded/main-director.mp4`, `illustration-director.mp4`, `conclusion-director.mp4`, `main-control.mp4`; `bounded/qa.json: PASS`
- **Full 42:40 Render**: `artifacts/full-sermon-pilot-v1-1/full-sermon-live-ai-reviewed.mp4` (1,493,135,785 bytes, 2560.00s video / 2560.04s audio)
  - Wall-clock render time: 3,353.46s (55m 53.46s) vs 3,516.41s baseline (162.95s / 2.72 min saved, 4.63% speedup)
  - Realtime factor: 1.31
  - Frame rate: 30 fps (intentional, matches source video `r_frame_rate: 30/1` and composition `fps={30}`)
- **Final QA**:
  - `visual-qa.json`: PASS (17 approved operations, all 5 canonical frame checkpoints present)
  - `audio-qa.json`: PASS (authoritative sermon audio preserved, B-roll muted, 48kHz stereo AAC, drift 0.0427s < 0.1s)
  - `review/readiness.json`: READY FOR FINAL RENDER (ready: true, 0 blockers)
  - Rights & Placement: PASS (rights-safe media only, collision-free V3 placement)
- **Review Workspace Bundling**: esbuild browser plugin resolves `foundation.ts` to pure TypeScript SHA-256 stub, preventing server-only Node builtins (`node:crypto`, `node:fs`, etc.) from leaking into the client UI bundle.
- **5-Minute Performance Benchmark**:
  - Baseline (concurrency null / 8): 407.42s
  - Optimized (concurrency 12, preset veryfast): 375.31s
  - Savings: 32.11s (7.88% speedup, realtime factor 1.25)
  - Confirms positive optimization trajectory consistent with full render
- **Gate**: GO
