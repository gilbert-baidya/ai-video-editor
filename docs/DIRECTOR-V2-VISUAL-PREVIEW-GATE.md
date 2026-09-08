# Director V2 Visual Preview Gate

## Scope

This gate covers the bounded Director V2 preview for the canonical Bengali semantic fixture and the real sermon source. It proves:

`Canonical Bengali Transcript -> AI Semantic Director -> Reverent Retention Policy -> Visual Beat Map -> Deterministic Layout Decisions -> Validated Edit Plan -> Remotion Preview -> Representative Visual QA`

The preview uses source seconds 4080-4200 and the corresponding hardened semantic section `source-segment-4080` through `source-segment-4120`. Transcript content and AI-generated timestamps were not modified.

## Evidence

- Control render: `artifacts/director-v2-preview/control-preview.mp4`
- Director render: `artifacts/director-v2-preview/director-preview.mp4`
- Before/during/after frames: `artifacts/director-v2-preview/frames/`
- Policy decisions: `artifacts/director-v2-preview/policy-decisions.json`
- V2 edit plan: `artifacts/director-v2-preview/edit-plan.json`
- Budget: `artifacts/director-v2-preview/visual-budget.json`
- Visual QA: `artifacts/director-v2-preview/qa.json`
- Cache dependencies: `artifacts/director-v2-preview/cache.json`
- Before/after diagnostic: `artifacts/director-v2-preview/before-after-diagnostic.md`

## Results

- Semantic boundary preserved: the policy consumes the hardened analysis and canonical transcript hash.
- Policy result: one `ACCEPT` decision for the Bengali `keyword-graphic` main point, with no opaque AI coordinates.
- Layout: deterministic `16:9-graphic` safe-zone profile, upper-right graphic region, full speaker framing.
- Visual QA: PASS; graphic bounds valid, Bengali display text non-empty, no unsupported positions, no caption/graphic collision.
- Event budget: 1 visual event over 120 seconds, 0.5 events per minute.
- Representative frames: before, during, and after the event were captured and visually inspected.
- Cache separation: semantic analysis, retention policy, layout policy, preview plan, source, and presentation hashes are recorded independently.

## Known Boundary

This milestone intentionally does not implement B-roll retrieval, word-level editing, transcript changes, or full-sermon processing. B-roll recommendations are retained as `keep-current` in the policy because no retrieved media is available in this preview.

## Final Verdict

**GO**
