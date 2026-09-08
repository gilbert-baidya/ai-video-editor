# Full Sermon Pilot V1 Gate

## Verdict

**CONDITIONAL GO**

The complete real Bengali sermon traversed the local pipeline through a validated human-reviewed Edit Plan and a complete 1920×1080 Remotion render with valid AAC sermon audio. The pressure-cooker image was selected through normal semantic ranking, rights and technical gates, V3 placement, and was visibly proven in the bounded AI Director preview. The final human review then exercised **Keep Pastor**, removing that B-roll from the approved full render without mutating the AI plan.

The result is conditional rather than GO because the local Ollama provider was unavailable. The run therefore used the explicit deterministic semantic fallback and does not prove live full-sermon LLM inference. Long-form rendering also took approximately 58.6 minutes, and the initial full-sermon semantic map is intentionally coarse and visually sparse. These are performance/semantic-polish limitations, not pipeline integrity or rendering failures.

## Source

- Project: `GOLDEN-E2E---Intervention-Sermon-2`
- Sermon: **হস্তক্ষেপ | INTERVENTION — Acts 12:1–17**
- Original source: SermonClip project `Original/youtube-source.mp4`
- Source probe: 5,906.034 seconds, 1280×720 H.264 video, 48 kHz stereo Opus audio.
- The original source and all proof-library media remained unchanged.

Evidence: [selected sermon range](../artifacts/full-sermon-pilot-v1/sermon-range.json), [source extraction](../artifacts/full-sermon-pilot-v1/source-extraction.json)

## Selected Sermon Range

The canonical sermon range is **54:00–96:40** of the live recording: 2,560 seconds, or **42:40**.

- At 54:00 the preacher welcomes the congregation and takes the Acts 12 message.
- At 54:40 he says Acts 12:1–17 has already been read and begins the sermon questions.
- At 96:20 he asks the congregation to stand and says the message is ending.
- At 96:40 the transcript transitions to congregational prayer.

Worship, announcements, pre-sermon prayer, post-sermon prayer, and benediction were excluded. The selected range is persisted with segment-safe confidence rather than silently inferred.

## Transcript Provenance

- Existing SermonClip canonical Bengali transcript was reused; no Whisper retranscription was run.
- Provider/model provenance: SermonClip / `indicconformer-bn`.
- 128 canonical source segments cover the complete selected range.
- Application-owned IDs are stable (`source-segment-*`), with times normalized to 0–2,560 seconds while the absolute source range remains separately persisted.
- Timing confidence is `segment-safe`; no word-level timing is claimed.

Evidence: [canonical pilot transcript](../artifacts/full-sermon-pilot-v1/transcript.json)

## Full Sermon Analysis

The merged analysis contains 13 ordered sections spanning the complete sermon: introduction, question, main point, Scripture/exposition, story, pressure-cooker illustration, teaching, application, prayer, further teaching, unexpected-grace story, testimony, and conclusion.

The pressure-cooker section is grounded in the real canonical transcript around absolute 70:40 onward, where the preacher repeatedly discusses a pressure cooker, internal pressure, cooking, and its connection to pressure in life. The later unexpected-grace story does not reuse that image and correctly returns no suitable asset.

Evidence: [full analysis](../artifacts/full-sermon-pilot-v1/analysis/sermon-analysis.json)

## Chunking Strategy

- Six bounded semantic chunks.
- Up to 24 canonical segments per chunk, with two-segment overlap.
- Input sizes range from 4,328 to 6,010 characters.
- Overlap is reconciled against application-owned section boundaries, so merged sections are not duplicated.
- Every chunk records ID, segment range, input size, provider result, fallback, section IDs, and merge result.

Evidence: [chunk ledger](../artifacts/full-sermon-pilot-v1/analysis/chunks.json)

## Director Provider/Model

- Requested local provider endpoint: Ollama at `127.0.0.1:11434`.
- Observed state: endpoint unavailable.
- Actual provider result: `deterministic-fallback`.
- Fallback: `local-long-form-semantic-merge / anchor-classifier-v1`.
- No AI runtime is claimed because no live model request succeeded.

Evidence: [Director stage](../artifacts/full-sermon-pilot-v1/analysis/director-stage.json)

## Semantic Reliability

The fallback preserves canonical segment identity and full-range coverage, and the major sermon progression agrees with the existing transcript and SermonClip/Qwen clip evidence. It is adequate for orchestration and render proof but is not equivalent to a successful full-sermon LLM analysis. This is the main gate condition.

## Reverent Retention

- 13 semantic beats.
- Three retained policy visual events before B-roll resolution.
- Seven explicit no-change/keep-current decisions.
- Ten `ACCEPT` and three `MODIFY` policy records.
- Consecutive `none`/`speaker-full` beats are valid no-change rhythm and are no longer incorrectly flagged as repeated visual events.

Evidence: [retention decisions](../artifacts/full-sermon-pilot-v1/retention-decisions.json)

## Visual Event Density

- Sermon duration: 42:40.
- AI Edit Plan operations: four (two speaker positions, one full-screen Bangla graphic, one B-roll operation).
- Approved Edit Plan operations: three after Keep Pastor removes B-roll.
- Retention event density: **0.07 events/minute**.

This is substantially below the 30–50-event design guidance. It is restrained and ministry-safe, but the coarse deterministic semantic pass produces a pilot that is probably too sparse for final product quality. Thresholds were not lowered and irrelevant visuals were not inserted to meet a quota.

## B-roll Decisions

`Pressure Cooker.png` won through the unchanged ranking path for section 6:

| Component | Score |
|---|---:|
| Semantic | 0.625 |
| Category | 0.500 |
| Technical | 1.000 |
| Rights | 1.000 |
| Reuse penalty | 0.000 |
| Final | **0.7125** |

The asset is 1200×1188 PNG, technically valid, has no audio, and has stable ID `media-56664ae949e57baf7a67302f`. The approved proof-root copy is eligible. A staged duplicate under `public/` remains `unknown` and ineligible, proving that rights did not leak across roots. The full live-recording MP4 scored only 0.265 for this image intent and remained ineligible on semantic/media-type grounds.

Evidence: [candidate rankings](../artifacts/full-sermon-pilot-v1/candidate-rankings.json), [media inspection](../artifacts/full-sermon-pilot-v1/media-index/inspection.json), [explanation chain](../artifacts/full-sermon-pilot-v1/explanation-chain.json)

## No-Broll Decisions

- Nine direct `NO B-ROLL` decisions.
- Three `NO SUITABLE ASSET` outcomes.
- Scripture, application, prayer, and conclusion remain speaker-led.
- The later unexpected-grace story does not select the pressure-cooker image.

The availability of approved media did not increase visual aggression.

## Visual Intelligence

- Four source frames were selectively sampled only around the main-point layout and selected pressure-cooker beat.
- V3 safe-zone scores for the pressure-cooker beat were below the split-screen threshold because both sides overlapped the subject.
- V3 therefore resolved the B-roll to full screen; it was not renderer-hard-coded.
- The Bangla main-point graphic also used V3 evidence and resolved to a full-screen fallback because no title-safe region met score/text-fit thresholds.
- Placement validation has zero failures.
- Visual-analysis cache key: `e213161a382ee47888e397ea7f54df35c815593479d1aedff3408590078f855e`.

Evidence: [placement evidence](../artifacts/full-sermon-pilot-v1/placement-evidence.json), [visual analysis](../artifacts/full-sermon-pilot-v1/placement-visual-analysis.json)

## Full Beat Map

All 13 meaningful beats persist source-relative time, section, intensity, AI recommendation, policy decision, final visual, confidence, reason, and review requirement. No-change decisions remain visible to Review Workspace without becoming renderer operations.

Evidence: [full Beat Map](../artifacts/full-sermon-pilot-v1/beat-map.json)

## Full Edit Plan

The original AI plan is preserved separately and validates across 0–2,560 seconds with no illegal overlaps. It contains four operations. B-roll enters the plan only after semantic search, ranking, rights, technical, V3, and timing resolution.

Evidence: [AI Edit Plan](../artifacts/full-sermon-pilot-v1/edit-plan.json)

## Review Workspace

The existing workspace loads the complete 42:40 timeline with all 13 decision cards, filters, progress summary, candidate rankings, preview, and visual evidence.

Measured in the real browser:

- Reload to last visible decision card: 220 ms.
- Needs Review filter response: 298 ms.
- 13 decision cards plus one inspector article.
- Four initial pending decisions; nine safe accepted/no-change decisions.
- Full duration and pressure-cooker candidate were visible.
- No virtualization was needed at this decision count.

Evidence: [Review Workspace](../artifacts/full-sermon-pilot-v1/index.html), [browser performance](../artifacts/full-sermon-pilot-v1/review-workspace-performance.json), [screenshot](../artifacts/full-sermon-pilot-v1/review-workspace.png)

## Human Review Proof

The review model demonstrates:

- explicit acceptance of restrained speaker-position decisions;
- a Keep Pastor rejection for the selected pressure-cooker B-roll;
- modification and approval of `ঈশ্বর অসম্ভব পরিস্থিতিতেও হস্তক্ষেপ করেন`;
- final text trust changed to `approved-display`;
- inspection of the B-roll decision and its full candidate ranking;
- preserved NO B-ROLL decisions;
- a separate modify→revert action trace returning a decision to its AI/pending state.

The AI plan is not mutated. Final review counts are 11 accepted, one modified, one rejected.

Evidence: [initial state](../artifacts/full-sermon-pilot-v1/review/director-review-initial.json), [reviewed state](../artifacts/full-sermon-pilot-v1/review/director-review.json), [action trace](../artifacts/full-sermon-pilot-v1/review-action-trace.json)

## Readiness State

Final readiness is **READY FOR FINAL RENDER**, with zero blockers. The remaining warning confirms that no-B-roll decisions remain active.

Evidence: [readiness](../artifacts/full-sermon-pilot-v1/review/readiness.json)

## Approved Edit Plan

The approved plan contains:

- speaker-left at 19:00–22:00;
- speaker-right at 29:00–32:00;
- approved full-screen Bangla main point at 6:00–10:00.

It has no invalid ranges or overlaps. The selected AI B-roll is absent because the human Keep Pastor decision removed it. The approved display text carries `approved-display` trust; no unverified Scripture card is rendered.

Evidence: [approved Edit Plan](../artifacts/full-sermon-pilot-v1/review/approved-edit-plan.json)

## Bounded Preview Results

- 300-second control and AI Director previews cover sermon-relative 15:00–20:00.
- The selected B-roll maps from 16:00–19:00 into preview-relative 1:00–4:00, with positive visible duration.
- Before, during, and after frames exist.
- Control and during-B-roll frame hashes differ, satisfying visibility/pixel-difference QA.
- The during frame visibly contains the pressure-cooker image.
- A separate 20-second font-size 62→66 presentation preview passed.

Evidence: [control preview](../artifacts/full-sermon-pilot-v1/control-preview.mp4), [Director preview](../artifacts/full-sermon-pilot-v1/director-preview.mp4), [before](../artifacts/full-sermon-pilot-v1/frames/before-broll.png), [during](../artifacts/full-sermon-pilot-v1/frames/during-broll.png), [after](../artifacts/full-sermon-pilot-v1/frames/after-broll.png), [render evidence](../artifacts/full-sermon-pilot-v1/render-evidence.json), [presentation rerender](../artifacts/full-sermon-pilot-v1/presentation-only-preview.mp4)

## Full Render

- Output: `artifacts/full-sermon-pilot-v1/full-sermon-reviewed.mp4`
- Duration: 2,560.043 seconds.
- Resolution: 1920×1080, 16:9.
- Video: H.264.
- File size: 1,694,338,594 bytes (about 1.58 GiB).
- Complete Remotion render succeeded.

Evidence: [full reviewed render](../artifacts/full-sermon-pilot-v1/full-sermon-reviewed.mp4), [ffprobe result](../artifacts/full-sermon-pilot-v1/full-render.json)

## Audio QA

- Final output has 48 kHz stereo AAC audio for the complete render duration.
- Sermon source audio remains authoritative.
- No music was added.
- Every AI B-roll operation carries `muted: true`; the approved final plan contains no B-roll after Keep Pastor.
- No independent B-roll audio path exists for the selected PNG.

## Visual QA

Representative final frames were sampled at the main point, speaker reposition, reviewed Keep Pastor moment, reverent prayer, and conclusion. They are nonempty and visually coherent. The approved Bangla graphic has no visible clipping or missing glyph boxes. The Keep Pastor sample shows the preacher rather than the pressure-cooker image, confirming review application. No sampled frame is black or missing.

Evidence: [visual QA](../artifacts/full-sermon-pilot-v1/visual-qa.json), [final frames](../artifacts/full-sermon-pilot-v1/frames/final)

## Cache/Rerun

The cache-only run completed without retranscription, semantic reanalysis, V3 reanalysis, or full rendering:

- media index/metadata: 10 reused, 0 indexed, 0 removed;
- V3 visual analysis: cache hit;
- full source and full reviewed render: reused;
- presentation-only change: graphic font size 62→66;
- rerun output: 20-second `presentation-only-preview.mp4`;
- upstream transcript, analysis, Director output, media index, V3 analysis, review state, and approved Edit Plan remained reusable.

Evidence: [cache proof](../artifacts/full-sermon-pilot-v1/cache.json)

## Failure Recovery

A controlled in-memory downstream Edit Plan copy was given an out-of-range operation. Validation rejected it. The invalid copy was discarded, the persisted approved plan revalidated with zero failures, and the existing full render was reused. Transcript, analysis, and review hashes remained unchanged.

Remotion V1 does not resume a partially encoded MP4. It can retry final rendering from persisted transcript, analysis, Beat Map, AI plan, review state, and approved plan without rerunning upstream stages.

Evidence: [failure recovery](../artifacts/full-sermon-pilot-v1/failure-recovery.json), [job stages](../artifacts/full-sermon-pilot-v1/job-status.json)

## Performance

| Metric | Result |
|---|---:|
| Sermon duration | 2,560 s / 42:40 |
| Transcript segments | 128 |
| Semantic chunks | 6 |
| Beat Map entries | 13 |
| AI plan operations | 4 |
| Approved operations | 3 |
| Selective V3 frames | 4 |
| Control preview wall time | ~387.9 s |
| Director preview wall time | ~401.3 s |
| Full render wall time | ~3,516.4 s / 58.6 min |
| Browser workspace load | 220 ms |
| Needs Review filter | 298 ms |
| Final file size | 1,694,338,594 bytes |

Preview/full-render times are measured from artifact completion timestamps. AI runtime, first-run Director runtime, detector runtime, media-search runtime, and peak RSS were not instrumented; no values are invented for them.

Evidence: [performance](../artifacts/full-sermon-pilot-v1/performance.json)

## Regression

Passed:

- `npm run typecheck`
- `npm run test-tokenization`
- `npm run prove-sol-foundation-fixes`
- `npm run test-director-review-workspace`
- `V4_MEDIA_RIGHTS=approved V4_PROOF_MEDIA_RIGHTS_POLICY_VERSION=proof-library-v1 npm run prove-director-v4-approved-broll` — selected 1, no-B-roll 3, zero QA failures.
- Full Sermon Pilot cache-only rerun — QA PASS and READY FOR FINAL RENDER.

## Known Limitations

1. The Ollama endpoint was unavailable, so this run does not prove live long-form LLM semantic inference.
2. The deterministic 13-section analysis is coherent but coarse; three reviewed visual operations are likely too sparse for polished production pacing.
3. Full Remotion rendering takes about 59 minutes on this machine and cannot resume a partial encode.
4. Peak memory and several first-run stage runtimes were not instrumented.
5. The Review Workspace opens in the intentionally unreviewed state (`REVIEW BLOCKED`); the persisted proof review separately reaches READY FOR FINAL RENDER. A future product pass should make switching between AI and persisted reviewed state clearer.

## Recommendation

Retain **CONDITIONAL GO** for Full Sermon Pilot V1. The end-to-end full-sermon workflow, rights isolation, B-roll ranking, V3 placement, human overrides, approved-plan derivation, complete render, audio/visual QA, cache reuse, and downstream recovery are proven. Promote to GO after one run with a live supported semantic provider, measured stage instrumentation, and a reviewed improvement to long-form visual pacing/performance.
