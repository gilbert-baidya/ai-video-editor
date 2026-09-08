# Director V4.1 Approved B-roll Positive Selection Proof

Date: 2026-09-07  
Branch: `feat/director-v4-approved-broll-proof`

## Verdict

GO

The owned pressure-cooker image was discovered, selected through normal semantic ranking, rights-gated, placed by V3 Visual Intelligence, visibly rendered, audio-safe, and reused from cache on the second run.

## Asset

Proof asset:

`local-media-proof/Pressure Cooker.png`

The original image was not modified. SHA-256:

`75883fa5a0dece335d15c661984574c2e9ab0f6e3820f6858490541e663d4994`

Technical inspection:

- Type: PNG image
- Dimensions: 1200×1188, approximately 1:1
- Pixel format: RGBA
- Probe score: 99
- Stable media ID: `media-56664ae949e57baf7a67302f`
- Indexer: `usable: true`
- No audio stream

## Rights

The proof runner explicitly configured `V4_MEDIA_RIGHTS=approved` for the `approved-proof-library` root only. The indexed provenance is:

- `rightsStatus: approved`
- `rightsSource: library-root-default`
- `libraryRootId: approved-proof-library`
- `libraryPolicyVersion: proof-library-v1`

The unrelated `public-source-media` root remained `unknown`; all four public assets remained unknown. The previously placed live sermon MP4 inside the proof root was also approved by this proof-root policy but was ranked below the pressure-cooker image and not selected.

## Searchable Metadata

The existing indexer generated multilingual-search-compatible metadata from the filename:

- Tags: `pressure`, `cooker`
- Category: `illustration`
- Search terms: `pressure`, `cooker`, `png`, `illustration`

The existing synonym expansion added Bangla-to-English concept aliases for `প্রেসার`, `কুকার/কুকারের`, and `উদাহরণ`. This preserved the existing normalized metadata-ranking architecture and did not change the suitability threshold.

## Sermon Moment

The existing real Bengali sermon analysis identified the pressure-cooker illustration at canonical source range `260–340` seconds. Its visual recommendation is `image-broll`, making the pressure-cooker image an editorially defensible match. The existing Scripture, main-point, and application sections remained speaker-led/no-B-roll where appropriate.

## Pipeline

The proof followed:

`Sermon semantic beat → B-roll intent → Reverent Retention → local media search → candidate ranking → rights gate → technical gate → V3 Visual Intelligence → placement → Edit Plan → Remotion`

No asset was manually selected or hard-coded into Remotion. The selected asset ID appears in the ranked decision and generated Edit Plan.

## B-roll Intent

- Section: `section-3`
- Decision: `search`
- Query: `প্রেসার কুকারের উদাহরণ`
- Desired media: `image`
- Preferred categories: `illustration`, `nature`
- Unknown rights allowed: `false`
- Reverent Retention: permitted this story-illustration search; calm speaker-led sections remained suppressed/no-B-roll.

The intent’s searchable terms include the Bengali source vocabulary plus the existing English aliases `pressure`, `cooker`, `example`, and `illustration`.

## Candidate Ranking

The full ranking is persisted in `artifacts/director-v4-local-broll/candidate-rankings.json`.

Winning image:

- Asset ID: `media-56664ae949e57baf7a67302f`
- Semantic score: `0.75`
- Category/metadata score: `0.5`
- Technical score: `1`
- Rights score: `1`
- Reuse penalty: `0`
- Final score: `0.775`
- Eligible: `true`
- Selection reason: matched `pressure`, `cooker`, `illustration`, `stress`, and `cooking`; matched preferred category `illustration`; dimensions/media type were compatible; rights were approved.

The approved live sermon recording ranked second with semantic `0`, category `0`, technical `0.35`, rights `1`, final `0.2025`, and `eligible: false`. It was not selected merely because it was approved. Public unknown-rights candidates remained ineligible.

## Selection

`selected-media.json` records:

- `selectedAssetId: media-56664ae949e57baf7a67302f`
- `decision: selected`
- `confidence: 0.775`

The Edit Plan contains one B-roll operation, `broll-section-3`, with no manual bypass.

## No-B-roll Preservation

Three legitimate no-B-roll decisions remained for Scripture reading, the non-illustrative main point, and direct application. Only the pressure-cooker illustration received B-roll; approved media did not increase visual density elsewhere.

## Source vs Preview Timing

The canonical operation range `260–340` maps through the existing preview window `240–360` to preview-relative `20–100` seconds. The Edit Plan preserves:

- `sourceStart: 260`
- `sourceEnd: 340`
- `start: 20`
- `end: 100`

The interval has positive duration, lies inside the 120-second Remotion composition, and is segment-safe.

## V3 Placement

The selected image passed through V3 frame analysis using beat-relative samples at preview times `20`, `60`, and `100` seconds. V3 resolved:

- Decision: `place`
- Placement: `right`
- Render mode: `split-right`
- Candidate right score: `0.52`
- Candidate left score: `0.4526`, penalized by subject overlap
- Text fit: true, font size `62`, one line

Placement reason: `V3 visual evidence selected right for split-screen B-roll: Clear title-safe candidate with available visual area.`

Visual evidence is persisted in `artifacts/director-v4-local-broll/placement-evidence.json` and the placement-source frames.

## Render Proof

The runner produced both previews from the same bounded sermon range:

- Control: [control-preview.mp4](../artifacts/director-v4-local-broll/control-preview.mp4)
- Director: [director-preview.mp4](../artifacts/director-v4-local-broll/director-preview.mp4)

Both outputs are approximately 120.042667 seconds. The required boundary frames are present:

- [before-broll.png](../artifacts/director-v4-local-broll/frames/before-broll.png)
- [during-broll.png](../artifacts/director-v4-local-broll/frames/during-broll.png)
- [after-broll.png](../artifacts/director-v4-local-broll/frames/after-broll.png)

Visual inspection confirms the during frame contains the pressure-cooker image on the right, while before and after show the sermon-only view. Existing visibility QA recorded:

- Operation: `broll-section-3`
- Sample time: `60` seconds
- Control/director hashes differ
- `visiblyDifferent: true`

`qa.json` reports `status: PASS` and zero failures.

## Audio

The selected asset is an image and has no audio stream. Both control and Director previews contain valid H.264 video plus AAC audio at 48 kHz stereo. Sermon/source audio remains authoritative. `qa.json` records `renderHasAudio: true` and `brollAudioMuted: true`; no B-roll audio path exists for the selected image.

## Cache Proof

The proof was run twice with unchanged proof media and the same approved proof-root policy.

Embedded cache proof:

- First isolated run: 6 indexed, 0 reused, 0 removed.
- Second isolated run: 0 indexed, 6 reused, 0 removed.

The final unchanged-state index pass reused all 6 records. The approved image’s stable ID and metadata were reused; the four unrelated public records remained `unknown`. Evidence is persisted in `artifacts/director-v4-local-broll/cache.json` and `media-index/index.json`.

## Regression Results

- `npm run typecheck`: PASS
- `npm run test-tokenization`: PASS
- `npm run prove-sol-foundation-fixes`: PASS
- `npm run prove-director-v4-approved-broll`: PASS; selected 1, no-B-roll/no-suitable count 3, zero QA failures
- V4.1 proof run twice: PASS; unchanged cache reuse verified

## Known Limitations

- The English filename required the existing synonym-expansion vocabulary to expose Bangla/English pressure-cooker equivalence; no threshold was changed.
- V3 placement is based on the sermon source-frame evidence and resolves a safe split region; the image itself has no audio.

## Recommendation

GO

The approved pressure-cooker image was genuinely relevant, selected through normal ranking, rights-safe, correctly mapped, V3-placed, visibly rendered, audio-safe, and cache-safe. No Director Review Workspace was started.
