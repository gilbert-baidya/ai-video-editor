# Director Review Workspace V1 Gate

## Verdict

**GO**

The first human-review surface is usable against the real Bengali Director fixture. It keeps canonical AI evidence separate from review state, supports deterministic visual overrides, validates the reviewed Edit Plan, persists decisions, and rerenders only downstream visual artifacts.

## Input artifacts

The workspace is populated from the completed V4.1 pressure-cooker proof, not synthetic English demo data:

- [sermon analysis](/Volumes/Personal/Cool App/ai-video-editor/app/ai-video-editor/artifacts/director-structured-output/analysis/sermon-analysis.json)
- [V4.1 AI-resolved Edit Plan](/Volumes/Personal/Cool App/ai-video-editor/app/ai-video-editor/artifacts/director-v4-local-broll/edit-plan.json)
- [candidate rankings](/Volumes/Personal/Cool App/ai-video-editor/app/ai-video-editor/artifacts/director-v4-local-broll/candidate-rankings.json)
- [placement evidence](/Volumes/Personal/Cool App/ai-video-editor/app/ai-video-editor/artifacts/director-v4-local-broll/placement-evidence.json)
- [V4.1 QA](/Volumes/Personal/Cool App/ai-video-editor/app/ai-video-editor/artifacts/director-v4-local-broll/qa.json)

The UI bundle and real serialized view-model are in [the review workspace artifact directory](/Volumes/Personal/Cool App/ai-video-editor/app/ai-video-editor/artifacts/director-review-workspace-v1/index.html).

## UI architecture

The existing branch has a Remotion composition and Director contracts, but no prior Vite route or review workspace. The chosen integration is a browser-safe React surface that consumes a serialized artifact view-model. `src/director-review.ts` is the deterministic review data layer; `src/DirectorReviewWorkspace.tsx` is the UI; the existing Remotion composition remains the renderer.

The flow remains:

`Canonical Transcript → AI Semantic Director → Reverent Retention → V3 / media evidence → AI Edit Plan → Review State → Approved Edit Plan → Remotion`

The UI does not become editorial truth. The original AI plan is preserved beside the human review state.

## Decision cards and timeline

Each of the four real analyzed sections has a concise card with time, section type, Bangla content, AI recommendation, retention outcome, confidence, display-text trust, reason, review status, and relevant asset evidence. The lower timeline marks each event as B-roll or NO B-ROLL and uses pending, accepted, modified, or rejected status styling.

The workspace includes filters for All, Needs Review, B-roll, No Change, Accepted, Modified, and Rejected. Selecting an event updates the inspector and seeks the video player to the bounded preview-relative time.

## Pressure-cooker decision card

The real section is `section-3`, canonical source range **260–340s**, mapped by the existing preview window to **20–100s**. The card shows:

- AI recommendation: `image-broll`
- Reverent Retention: `SEARCH → SELECT`
- selected asset: `Pressure Cooker.png`
- final score: `0.775`
- component scores: semantic `0.75`, category `0.50`, technical `1.00`, rights `1.00`, reuse penalty `0.00`
- V3 placement: `split-right`, selected region `right`
- trust: `ai-suggested-unapproved`
- rights: approved from the proof library; unknown-rights public media is visibly ineligible

The full evidence chain is expandable through the UI and is retained in the [V4.1 explanation chain](/Volumes/Personal/Cool App/ai-video-editor/app/ai-video-editor/artifacts/director-v4-local-broll/explanation-chain.json).

## B-roll review

The selected asset is shown with its thumbnail and candidate ranking. The ranking includes the six real indexed candidates, score components, technical state, rights state, eligibility, and reason. The UI exposes Accept, Replace B-roll, Keep Pastor, Approve text, Edit text, Preview, and Revert to AI where applicable. Replace opens an indexed, rights-safe candidate picker; this fixture honestly has no alternate eligible replacement. Unknown-rights media remains marked and cannot be accepted as an automatic final candidate.

The pure review reducer was tested for Accept, Reject, Modify, Replace action routing, and Revert. Accept retains the AI operation. Reject / Keep Pastor removes only the visual operation and preserves the semantic beat and AI evidence.

## No-B-roll behavior

Three real sections remain speaker-led and visible as NO B-ROLL:

- Scripture reading, `0–80s`
- main point, `120–160s`
- application, `360–400s`

No extra visual density is introduced simply because approved media exists. No-change decisions do not require artificial approvals.

## Text review

Bangla display text shows its trust state rather than silently becoming approved. The proof uses the real canonical wording `প্রার্থনা করছেন আর উত্তর আপনার দরজার সামনে দাঁড়িয়ে আছে` as an explicitly approved display line. The review reducer preserves the original suggested text and records approved text separately.

The UI uses Unicode Bengali without normalization or destructive transliteration. Edit text opens a native multi-line Bangla-capable editor and persists the explicit approval separately. Existing tokenization coverage passes for conjuncts, vowel signs, mixed script, Bible references, and multi-line-capable strings.

## Scripture review

The real Scripture section remains visibly marked `SCRIPTURE REFERENCE NEEDS REVIEW`. Its Keep Pastor / Remove graphic action is available, and readiness blocks any unresolved unverified Scripture card. No Scripture retrieval or verification system was added.

## Human override proof

The proof applies a real review override to the pressure-cooker event:

`AI = split-right Pressure Cooker B-roll → human = Keep Pastor`

The original AI preview is copied to [original-ai-preview.mp4](/Volumes/Personal/Cool App/ai-video-editor/app/ai-video-editor/artifacts/director-review-workspace-v1/original-ai-preview.mp4). The reviewed plan is derived independently and rendered to [reviewed-preview.mp4](/Volumes/Personal/Cool App/ai-video-editor/app/ai-video-editor/artifacts/director-review-workspace-v1/reviewed-preview.mp4). The frame at 60s has a different SHA-256, proving the downstream visual changed.

Persisted review state: [director-review.json](/Volumes/Personal/Cool App/ai-video-editor/app/ai-video-editor/artifacts/director-review-workspace-v1/review/director-review.json)

Reviewed Edit Plan: [approved-edit-plan.json](/Volumes/Personal/Cool App/ai-video-editor/app/ai-video-editor/artifacts/director-review-workspace-v1/review/approved-edit-plan.json)

The reviewed plan has zero operations because the proof intentionally keeps the pastor and removes unresolved visual takeovers. It validates with zero failures and retains its four semantic beat decisions.

## Preview and evidence

- [workspace screenshot](/Volumes/Personal/Cool App/ai-video-editor/app/ai-video-editor/artifacts/director-review-workspace-v1/workspace-screenshot.png)
- [review override screenshot](/Volumes/Personal/Cool App/ai-video-editor/app/ai-video-editor/artifacts/director-review-workspace-v1/review-override-screenshot.png)
- [V4.1 control preview](/Volumes/Personal/Cool App/ai-video-editor/app/ai-video-editor/artifacts/director-v4-local-broll/control-preview.mp4)
- [V4.1 AI Director preview](/Volumes/Personal/Cool App/ai-video-editor/app/ai-video-editor/artifacts/director-v4-local-broll/director-preview.mp4)
- [reviewed preview](/Volumes/Personal/Cool App/ai-video-editor/app/ai-video-editor/artifacts/director-review-workspace-v1/reviewed-preview.mp4)
- [AI pressure-cooker frame at 60s](/Volumes/Personal/Cool App/ai-video-editor/app/ai-video-editor/artifacts/director-review-workspace-v1/frames/original-ai-60s.png)
- [reviewed Keep Pastor frame at 60s](/Volumes/Personal/Cool App/ai-video-editor/app/ai-video-editor/artifacts/director-review-workspace-v1/frames/reviewed-60s.png)
- [before B-roll](/Volumes/Personal/Cool App/ai-video-editor/app/ai-video-editor/artifacts/director-v4-local-broll/frames/before-broll.png), [during B-roll](/Volumes/Personal/Cool App/ai-video-editor/app/ai-video-editor/artifacts/director-v4-local-broll/frames/during-broll.png), [after B-roll](/Volumes/Personal/Cool App/ai-video-editor/app/ai-video-editor/artifacts/director-v4-local-broll/frames/after-broll.png)

The existing V4.1 render-visibility QA remains passing: the pressure-cooker during frame differs from control at the selected operation midpoint. The review proof also verifies the reviewed frame differs from the AI frame.

## Readiness

The deterministic readiness check blocks pending required visual decisions, unapproved display text where it is final-render relevant, unverified Scripture cards, unknown-rights selected assets, unusable media, invalid operations, and upstream QA failures.

The persisted proof state resolves those conditions by removing the unverified Scripture/pressure-cooker visual takeovers, accepting the speaker-led states, and explicitly approving one real Bangla display line. It reports **READY FOR FINAL RENDER** with a warning that no-B-roll decisions remain active.

[Readiness artifact](/Volumes/Personal/Cool App/ai-video-editor/app/ai-video-editor/artifacts/director-review-workspace-v1/review/readiness.json)

## Persistence and cache

Review state is persisted independently in `review/director-review.json`; the derived plan is persisted in `review/approved-edit-plan.json`. A reload of the generated workspace loads `review-data.json` and reconstructs the initial pending review state. The reducer tests also verify that the AI recommendation can be restored with Revert.

The review cache proof records unchanged source, transcript, sermon analysis, AI Edit Plan, media index, and V3 visual-analysis hashes. It explicitly invalidates only reviewed Edit Plan, reviewed preview render, and downstream QA after a review change; transcription, semantic analysis, media indexing, and V3 analysis are not rerun.

[Cache evidence](/Volumes/Personal/Cool App/ai-video-editor/app/ai-video-editor/artifacts/director-review-workspace-v1/review-cache.json)

## QA and regressions

- `npm run typecheck` — PASS
- `npm run test-director-review-workspace` — PASS: accept, reject, modify, revert, Bangla text approval, Scripture blocker, plan validation, persistence, cache boundary, reviewed render, UI bundle
- `npm run test-tokenization` — PASS
- `npm run prove-sol-foundation-fixes` — PASS
- `V4_MEDIA_RIGHTS=approved V4_PROOF_MEDIA_RIGHTS_POLICY_VERSION=proof-library-v1 npm run prove-director-v4-approved-broll` — PASS: selected `1`, no-B-roll `3`, QA failures `0`

[Review proof summary](/Volumes/Personal/Cool App/ai-video-editor/app/ai-video-editor/artifacts/director-review-workspace-v1/review-proof.json)

## Known limitations

This is a focused review workspace, not a professional NLE. Replace B-roll is limited to the already-indexed local candidates; no web or stock search exists. Text editing is represented by the deterministic review reducer and real Unicode data, with a compact V1 action surface rather than a full text editor modal. The initial fixture contains four meaningful analyzed beats, so the progress counter is four decisions rather than a full-sermon review inventory. Scripture remains review-blocked until a future verification workflow exists.

## Recommendation

**GO** — continue toward full-sermon editing with this review boundary. Do not start online media, publishing, Shorts, or additional Director features as part of this milestone.
