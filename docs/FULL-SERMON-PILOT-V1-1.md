# Full Sermon Pilot V1.1

## Status

| Area | Status |
|---|---|
| Provider-neutral Director execution | IMPLEMENTED, OFFICE-VALIDATED |
| Explicit AI-unavailable fallback | IMPLEMENTED, OFFICE-VALIDATED |
| Provenance in execution and review data | IMPLEMENTED, OFFICE-VALIDATED |
| Canonical full-sermon chunking | IMPLEMENTED, OFFICE-VALIDATED |
| Deterministic chunk reconciliation | IMPLEMENTED, OFFICE-VALIDATED |
| Independent stage cache | IMPLEMENTED, OFFICE-VALIDATED |
| AI-versus-fallback comparison harness | IMPLEMENTED, OFFICE-VALIDATED WITH MOCK AI |
| Canonical coverage contract and validator | IMPLEMENTED, OFFICE-VALIDATED |
| Bounded AI coverage repair | IMPLEMENTED, OFFICE-VALIDATED WITH MOCK AI |
| Provider status semantics correction | IMPLEMENTED, OFFICE-VALIDATED |
| Live Ollama/Qwen execution | VALIDATED (PERSONAL MAC) |
| Full 42:40 render | VALIDATED (PERSONAL MAC) |

No Ollama runtime, model, Python environment, Homebrew package, Docker service, or external application was installed or invoked during office validation.

## Provider-neutral architecture

`runFullSermonDirector` owns orchestration. It accepts an optional `DirectorProvider` rather than importing application behavior from Ollama:

1. Check the configured provider's availability.
2. Run structured analysis when available.
3. Validate schema and canonical segment ranges.
4. Use `DeterministicDirectorFallback` when no provider is configured, a provider is unavailable, or provider output fails.
5. Preserve provider, model, status, fallback reason, duration, attempts, schema result, and canonical-range result.

`OllamaDirectorProvider` is one adapter. Its failure no longer manufactures fallback output; orchestration performs fallback explicitly and records the true source. Future cloud adapters can implement the same provider interface.

The absence of Ollama is a supported state:

```text
providerStatus: UNAVAILABLE or NOT_CONFIGURED
source: deterministic-fallback
fallbackUsed: true
fallbackReason: explicit diagnostic
```

## Personal-Mac finding: successful AI chunks, mixed global result

The personal-Mac run on `feat/full-sermon-pilot-v1-1-provider-abstraction` (`5539dcd`) with Ollama 0.33.2 and `qwen3:30b` produced six chunks that all reported `ai-success` with structurally valid output and no per-chunk fallback. The global run still reported `fallbackUsed: true` and `source: mixed`.

Root cause: schema validity was conflated with canonical completeness. The provider contract asked for meaningful semantic sections but never required a decision for every primary canonical segment, and per-chunk validation only checked that the ranges it did return were well formed. Segments the model chose to say nothing about passed every check, then reconciliation deterministically gap-filled them, correctly marking the run mixed.

The reported `status: NOT_CONFIGURED` was a second, separate defect: the deterministic gap-fill provenance hard-coded `NOT_CONFIGURED`, and aggregation fell through to that value even though the provider was reachable and every chunk succeeded.

This finding led to the v1.2 canonical coverage contract. The personal-Mac retest completed with 128/128 primary segments covered by pure AI, zero gap-fill, and fallbackUsed: false.

## Canonical coverage contract

The provider contract now distinguishes primary segments from context-only overlap segments. Numbered prompt segments carry an explicit `role`, and the prompt requires:

- every primary segment index to appear in exactly one returned section;
- context-only segments to be read for meaning but never returned;
- an explicit decision (for example `speaker-full` or `none`) when a primary segment needs no visual intervention.

AI still returns only numbered ranges. The application resolves canonical IDs and timing.

## Coverage validator

`validateCanonicalCoverage` is deterministic and independent of schema validation. It reports covered primary IDs, missing primary IDs, duplicate coverage, conflicting sections, invalid IDs, context-only IDs incorrectly used as primary output, coverage percent, and the contiguous missing ranges. Three states are tracked separately and never conflated:

```text
schemaValidation
canonicalRangeValidation
canonicalCoverageValidation / canonicalCoverageComplete
```

## Bounded AI repair

If provider output is otherwise valid but misses primary canonical segments, orchestration issues a bounded repair request to the same provider for the uncovered ranges only, with full sermon context preserved. `maxCoverageRepairAttempts` defaults to `1` and never loops. Repair sections are accepted only when they cover exclusively still-missing primary segments; coverage is then re-validated. If coverage becomes complete, the run may be pure AI. If not, deterministic gap-fill is retained, the run stays mixed, and full-render validation is blocked.

Deterministic gap-fill is preserved as a safety mechanism, and its provenance is never converted into AI provenance.

## Provider status semantics

```text
NOT_CONFIGURED  no provider/model configuration exists
UNAVAILABLE     configured provider cannot be reached
FAILED          provider executed but failed
PARTIAL         provider succeeded but fallback was still required
MIXED           aggregate of units with differing outcomes
SUCCESS         valid complete provider result with no fallback
```

`AVAILABLE` is retained as an accepted alias of `SUCCESS` for older artifacts.

A run may report `fallbackUsed: false` only when the provider is available, every required chunk call succeeds, schema validation passes, canonical range validation passes, all primary canonical segments are covered by AI decisions, and no deterministic canonical gap-fill was required. Explicit AI no-change decisions count as AI coverage.

## Canonical chunking

- Chunks contain whole canonical transcript segments, never arbitrary character slices.
- Sentence-ending punctuation is preferred near the configured target size.
- Bounded canonical overlap provides adjacent context.
- Primary segment ranges are non-overlapping and reconstruct the original canonical segment sequence exactly.
- Chunk IDs derive deterministically from ordinal and canonical boundary IDs.
- Provider prompts contain numbered segments and application-owned canonical IDs, but providers only return numbered ranges.
- Application code resolves numbered ranges to canonical IDs and absolute timing.
- Resolved section IDs derive from canonical source segment IDs and remain stable across machines.

## Merge and reconciliation

Reconciliation resolves each canonical segment deterministically:

1. Reject recommendations containing unknown canonical IDs.
2. Prefer reverent classifications in conflicts.
3. Prefer higher confidence.
4. Use stable chunk order and section ID as tie-breakers.
5. Fill uncovered canonical segments with an explicit speaker-led no-change decision.
6. Coalesce adjacent segments only when their semantic recommendation is identical.
7. Suppress unsafe activity in prayer, Scripture, emotional-ministry, and altar-call sections.
8. Suppress duplicate visuals, cooldown violations, and events above the configured density limit.

Reverent Retention remains the downstream authority. Display text still passes through the existing trust policy, Scripture cards remain blocked until verification, B-roll selection rejects unknown rights, and V3 placement remains downstream of normalized Director output.

## Review Workspace

Review data can carry `directorExecution` provenance. The inspector shows provider, model, fallback state, and fallback reason. Each recommendation starts with either `ai` or `deterministic-fallback` provenance. Accept, reject, modify, replace, and display-text approval actions record `human-override`.

Older review artifacts without execution provenance remain readable and display an explicit fallback label derived from their Edit Plan metadata rather than crashing.

## Cache and resume

The stage cache uses a deterministic key composed of stage name, implementation version, and sorted input hashes. Writes are atomic. The supported stage vocabulary is:

1. media inspection
2. transcript loading
3. canonical transcript normalization
4. sermon chunk generation
5. Director analysis
6. Director normalization
7. Edit Plan
8. visual intelligence
9. media ranking
10. review overrides
11. rendering
12. QA

Coverage validation and repair participate in cache identity. The Director analysis and Director normalization stages moved to `v1.2` and include the coverage contract version and the configured repair bound, so results produced under the older coverage rules cannot be reused as valid pure AI. Chunk analysis is cached independently, allowing a restarted run to reuse completed chunks. Provider-unavailable and provider-failure results are not cached under an available provider identity, preventing an office fallback from masking a later personal-Mac AI run. Review changes can use a later-stage key without invalidating transcript, chunks, Director analysis, media inspection, or placement.

## Performance audit

Previous measured baseline: the 42:40 render took approximately 58.6 minutes.

Findings:

- The V1.1 script already bundles Remotion once and reuses that bundle for its bounded renders.
- Visual-frame analysis already has an input-keyed cache.
- Bounded and full outputs already support explicit cache-only reuse.
- The previous visual-analysis cache key loaded the entire 42-minute source file into Node memory solely to hash it.
- Director chunk progress was cached by a proof-specific implementation rather than a reusable stage boundary.
- Full rendering is still monolithic; unchanged-region rendering has not been introduced because that requires careful media/audio stitching validation.
- Media probing is performed once for each produced output in the current V1.1 proof. No repeated same-output probe was found in that path.

Implemented optimizations:

- Replaced the visual-analysis whole-file Buffer allocation with streaming SHA-256. This preserves content-aware invalidation while bounding Node memory use; it does not eliminate the source read.
- Added reusable per-stage cache keys, atomic writes, cache-hit reporting, and duration instrumentation.
- Added independently cacheable per-chunk Director analysis and merged-analysis normalization.
- Kept provider failures out of reusable AI caches.
- Added a full-render identity over the canonical source fingerprint, approved Edit Plan, selected-media fingerprints, render settings, renderer source, and dependency lockfile. Cache-only mode now rejects missing or stale render artifacts.

The bounded-memory benefit of the streaming source fingerprint is structurally evident but was not timed against the unavailable 42-minute local source on this office machine. Full render speed and output equivalence remain PERSONAL-MAC-VALIDATION-PENDING.

## Office-safe tests

`npm run test-full-sermon-v1-1` validates with small in-memory fixtures:

- missing and unavailable provider fallback
- explicit provider/fallback provenance
- sentence-aware canonical chunking and deterministic reconstruction
- deterministic overlap reconciliation
- reverent-section suppression
- B-roll rights hard gate
- review human-override provenance
- independent cache reuse and invalidation
- AI-versus-fallback metric generation using a mock provider
- coverage validator complete, incomplete, duplicate, invalid, and context-only misuse states
- CASE A: complete provider coverage yields pure AI provenance with no fallback
- CASE B: one omitted primary range, then a mock repair returns the missing range and coverage becomes complete
- CASE C: omitted range with a failing repair retains deterministic gap-fill, mixed provenance, and `fallbackUsed: true`
- CASE D: context-overlap-only output is rejected as primary coverage
- CASE E: all-primary explicit AI no-change is complete coverage with zero visual events and `fallbackUsed: false`

The standard `typecheck` and Bengali tokenization checks remain required. No live AI inference or full render is part of office validation.

## Personal-Mac production validation completed

All personal-Mac validation gates have passed:

- **Live Ollama/Qwen execution**: PASSED (`ollama` / `qwen3:30b`, 6/6 chunks, 128/128 primary canonical segments, 100% coverage, 0 gap-fill, fallbackUsed: false, pure AI provenance).
- **AI-vs-fallback comparison**: PASSED (85 AI beats vs 13 fallback beats; 16 AI visual events vs 3 fallback visual events; 69 AI no-change decisions).
- **Bounded previews**: PASSED (`main`, `illustration`, `conclusion` preview renders; bounded frame difference QA: PASS).
- **Full 42:40 render**: PASSED (`full-sermon-live-ai-reviewed.mp4` rendered in 3,353.46s / 55m 53.46s vs 3,516.41s baseline — 162.95s / 2.72 min saved, 4.63% speedup).
- **Frame rate**: 30 fps (intentional, matches source sermon `public/full-sermon-pilot-source.mp4` at `r_frame_rate: 30/1` and Remotion composition `fps={30}`).
- **QA validation**: Visual QA PASS (17 approved operations, 5 canonical frame checkpoints present), Audio QA PASS (sermon audio authoritative, B-roll audio muted, 48kHz stereo AAC, drift 0.0427s < 0.1s), Rights gate PASS, V3 placement PASS, Reverent Retention PASS, Review readiness READY FOR FINAL RENDER.
- **Review Workspace bundling**: Resolved browser bundling defect in `scripts/prove-full-sermon-pilot-v1-1.ts` via an esbuild browser plugin providing pure SHA-256 for `foundation.ts`, preventing server-only Node builtins (`node:crypto`, `node:fs`, etc.) from leaking into the client bundle.
- **5-minute benchmark**: PASSED (baseline 407.42s vs optimized 375.31s — 32.11s saved, 7.88% speedup, realtime factor 1.25).

Exact reproducibility commands and artifact paths are in `docs/PERSONAL-MAC-V1-1-VALIDATION.md`.
