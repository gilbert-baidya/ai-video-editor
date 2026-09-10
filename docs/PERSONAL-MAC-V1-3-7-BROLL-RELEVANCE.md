# V1.3.7 B-Roll Relevance Report

## Problem Statement
Previously, the visual director produced localized B-roll requests (e.g. "ancient king in famine") but the local retrieval matched poorly correlated tags (e.g. matching "Peter in prison"). We needed deterministic mapping of `subject, action, setting, mood, visualPurpose, exclusions` to prevent inappropriate visual pairing.

## Implementation
1. **B-Roll Intent Schema:** Implemented `AIBrollIntent` mapped directly to Gemini's output containing rigorous definitions of the desired B-roll context, including explicit `exclusions`.
2. **Relevance Validation:** Created deterministic checks (`evaluateAssetRelevance`) scoring assets as `HIGH`, `MEDIUM`, `LOW`, or `MISMATCH`.
3. **Hard Rejection:** Configured `LOW` and `MISMATCH` intent scores to strictly enforce `eligible: false`, explicitly blocking them from entering the Approved Edit Plan without explicit human workspace intervention.

## Benchmark Results
- **Semantic Stability:** The Visual Director accurately requested "ancient king and a desperate woman" and "ancient king in royal robes" across all tested `story` segments.
- **Negative Testing:** The "Peter in prison" local asset failed the `evaluateAssetRelevance` check (returning `MISMATCH`) because of explicit keyword conflicts within the exclusion list, correctly blocking it from being rendered.
- **Positive Testing:** The newly generated target asset `ancient_king_famine` successfully achieved `HIGH` semantic matching, resolving into an eligible renderer candidate.

## Conclusion
B-Roll Relevance: **GO**
