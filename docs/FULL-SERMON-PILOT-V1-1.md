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
| Live Ollama/Qwen execution | PERSONAL-MAC-VALIDATION-PENDING |
| Full 42:40 render | PERSONAL-MAC-VALIDATION-PENDING |

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

Chunk analysis is cached independently, allowing a restarted run to reuse completed chunks. Provider-unavailable and provider-failure results are not cached under an available provider identity, preventing an office fallback from masking a later personal-Mac AI run. Review changes can use a later-stage key without invalidating transcript, chunks, Director analysis, media inspection, or placement.

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

The standard `typecheck` and Bengali tokenization checks remain required. No live AI inference or full render is part of office validation.

## Remaining personal-Mac validation

Only the following remain:

- Run the real Ollama adapter with `qwen3:30b`.
- Confirm all chunks report AI source, schema PASS, and canonical range PASS.
- Compare the stored deterministic baseline with live AI output.
- Run bounded previews and inspect Review Workspace provenance.
- Run the full-sermon proof and benchmark on the personal Mac.
- Confirm final video/audio QA and compare full-render wall time with 58.6 minutes.

Exact commands and expected artifacts are in `docs/PERSONAL-MAC-V1-1-VALIDATION.md`.
