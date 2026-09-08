# Director V3 Visual Intelligence Gate

## Inputs

- Read-only source: `sermonclip-studio/Projects/GOLDEN-E2E---Intervention-Sermon-2/Original/youtube-source.mp4`
- Source duration: 5906.034 seconds, 1280x720.
- Director preview: source seconds 4080-4200, with the existing hardened Bengali semantic analysis and V2 retention policy.
- Preview beat samples: beat start, midpoint, and end at relative seconds 1, 30, and 59.
- Additional scenario frames: source seconds 600, 1800, 3000, 4200, and 5000.

## Detector

Local macOS Vision only:

- `VNDetectFaceRectanglesRequest`
- `VNDetectHumanBodyPoseRequest` as a subject fallback
- `VNDetectRectanglesRequest` for screen/existing-graphic occupancy
- FFmpeg for frame extraction and debug-frame rendering

No video or frame was uploaded to a cloud provider. No paid API or new npm dependency was introduced.

## Speaker Detection

The preview beat detected a centered speaker across all three representative frames. The five additional scenario frames produced:

- 600s: centered multi-person stage composition, confidence 0.7323.
- 1800s: right subject from body-pose fallback, confidence 1.0.
- 3000s: centered multi-person stage composition, confidence 0.7018.
- 4200s: centered subject, confidence 0.9124.
- 5000s: centered subject, confidence 0.8486.

The right-subject evidence case correctly preferred `left` placement with score 0.74.

## Face Detection

The preview speaker face was detected at approximately 0.76-0.84 confidence across the sampled frames. The selected upper-left region did not overlap the detected face. Wide stage frames contained multiple faces where Vision could identify them; the 1800s frame had no face result but received a body-pose subject fallback.

## Occupancy

Rectangle occupancy analysis ran locally. No high-confidence screen or existing-graphic rectangle was returned in the sampled scenario frames, so no fabricated occupancy was added. The safe-zone artifact records empty occupancy rather than claiming a slide was detected.

## Safe-Zone Scores

The preview beat scores were:

- `upper-left`: 0.5535, selected.
- `upper-right`: 0.5402.
- `left`: 0.4886.
- `right`: 0.4866.
- `lower-left`: 0.2294, caption-safe-area penalty.
- `lower-right`: 0.2134, caption-safe-area penalty.
- `center`: 0.1933, subject penalty.

The selected region met the 0.52 minimum score, stayed title-safe, and fit the Bengali display text in two lines at a deterministic 34px minimum font size.

## Placement Decisions

- Normal preview: `keyword-graphic` -> `place` -> `upper-left`.
- Right-subject evidence case: `place` -> `left`.
- Strict major-point case: no region met the 0.95 threshold -> `full-screen`.
- Strict minor-keyword case: no region met the 0.95 threshold -> `suppress`.

Placement decisions preserve AI recommendation, retention result, visual evidence paths, candidate scores, selected region, text-fit result, and final operation.

## Bangla Layout

The final Director frame renders `প্রার্থনার শক্তি` in a readable two-line-safe block with correct shaping and no clipping. The existing tokenization regression also passed for Bengali conjuncts, vowel signs, numerals, and the required long sentence fixture.

## Director Integration

`AI semantic recommendation -> Reverent Retention policy -> Visual Intelligence -> deterministic placement -> Edit Plan -> Remotion`

The policy remains responsible for whether a graphic should exist. Visual Intelligence only resolves where it can safely exist and can fail closed. AI never emits pixel coordinates.

## Debug Frames

- Source frames and sampled metadata: `artifacts/director-v3-visual-intelligence/frames/source/`
- Debug overlays with face, subject, occupancy, and selected-region boxes: `artifacts/director-v3-visual-intelligence/frames/debug/`
- Safe-zone artifact: `artifacts/director-v3-visual-intelligence/safe-zones.json`
- Placement explanations: `artifacts/director-v3-visual-intelligence/placement-decisions.json`
- Fallback evidence: `artifacts/director-v3-visual-intelligence/fallback-placement-tests.json`

## Final Preview Frames

- Control render: `artifacts/director-v3-visual-intelligence/control-preview.mp4`
- Director render: `artifacts/director-v3-visual-intelligence/director-preview.mp4`
- Full-screen fallback render: `artifacts/director-v3-visual-intelligence/full-screen-fallback-preview.mp4`
- Final frames: `artifacts/director-v3-visual-intelligence/frames/final/`

## Cache

`artifacts/director-v3-visual-intelligence/cache.json` records independent hashes for source video, frame samples, visual analysis, retention policy, semantic analysis, placement, and presentation. Visual analysis explicitly excludes transcript wording, AI model, font, color, and animation. Changing presentation style can therefore reuse the safe-zone analysis.

## Performance

- Preview representative frames: 3.
- Additional real scenario frames: 5.
- Total analyzed frames: 8.
- Frame sampling runtime: approximately 870 ms.
- Vision detector runtime: approximately 655 ms total, 81.9 ms/frame.
- Detector compilation runtime: approximately 811 ms.
- Per-frame work is selective and practical for longer sermons when sampling beats instead of every video frame.

## QA

- TypeScript: PASS.
- Placement QA: PASS.
- Face collision check: PASS for selected placement.
- Title-safe check: PASS.
- Bengali text-fit check: PASS.
- Full-screen fallback: rendered.
- Minor unsafe suppression: resolved in artifact evidence and omitted from the edit plan.
- Rapid speaker-position oscillation: no speaker-position operations were introduced by this preview.
- Canonical transcript: unchanged.
- Word-destructive edits: none.

## Known Problems

- The available real source frames are mostly centered or multi-person stage compositions. A reliable single-speaker-left example was not present in the sampled times, so left-speaker symmetry remains evidence-ready but not fully validated against a natural left-only shot.
- Rectangle occupancy did not detect a presentation slide or existing graphic in these samples. The architecture is present, but slide-specific accuracy needs a source frame containing a clear slide or lower third.
- Body-pose fallback can identify a right-side subject when face detection fails, but it is a subject estimate, not identity or speaker tracking.
- The placement score is a deterministic V1 heuristic, not a learned visual-balance model.

## Recommendation

**CONDITIONAL GO**
