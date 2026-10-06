# Phase 7D — Caption Safe-Area Report

## Starting Problem

The verified Phase 7C.3 Bengali Short rendered correctly, but generated captions occupied the lower portion of the frame where the source video already contained a persistent lower-third and scrolling ticker. The result was readable but visually crowded and required a minor edit before publishing.

## Detection / Safe-Area Strategy

The renderer now samples the source clip at two frames per second, scales the samples to a small grayscale analysis surface, and measures persistent edge occupancy across stable vertical bands:

- lower;
- center-lower;
- center;
- upper-center.

The selector chooses the first zone below the persistent occupancy threshold, in that order. This keeps normal captions low when the source is clear, but moves them upward when repeated text or graphic structure is present. If sampling fails or all zones are occupied/uncertain, rendering continues with an explicit conservative fallback instead of failing the job.

The selected zone is stable for the entire Short; captions do not jump between positions frame by frame.

## Implementation

- Added reusable source analysis and placement selection in `src/caption-safe-area.ts`.
- Added `captionZone` renderer input support.
- Added stable `lower`, `center-lower`, `center`, and `upper-center` caption styles.
- Preserved caption text, Bengali Unicode, English code-switching, timing, font weight, contrast, and shadow treatment.
- Kept transcript, ASR, boundary, source-duration, and media-QA contracts unchanged.
- Added focused safe-area regression coverage in `scripts/test-caption-safe-area.ts`.

## Before Evidence

Phase 7C.3 output preserved before rerender:

`phase7d-evidence/before-phase7d-caption-placement.mp4`

Frame review showed captions in the lower safe area competing with the source lower-third/ticker.

## After Evidence

The first fresh Phase 7D UI project completed a real import, Gemini transcription, Shorts discovery, approval, and render:

- Project: `project-68fc5d83-0019-4d29-b0ad-716e67fadcaa`
- Output: `1080×1920`, QA PASS
- The initial threshold selected `lower`, which was not sufficient for this source.

Independent source analysis after tightening the persistence threshold now selects:

`center-lower`

for the same verified source and Short range. This proves the corrected detector identifies the occupied lower region, but no post-threshold UI render was completed.

Three subsequent fresh UI attempts were not approved because Gemini Shorts candidates failed the existing complete-thought boundary validator:

`ends during active speech and no nearby complete-thought boundary was found`

No transcript, candidate, project state, or render output was injected to bypass this gate.

## Caption Zone Selected

- Initial Phase 7D render: `lower` — ineffective for the source lower-third/ticker.
- Corrected detector for the verified source: `center-lower`.
- Automatic fallback behavior: retained and logged when analysis is unavailable.

## Bengali/Banglish Verification

The safe-area implementation does not modify caption text. Existing regression coverage confirms Bengali and mixed Bengali/English strings remain unchanged:

- `রাজার স্বীকারোক্তি: আমি ব্যর্থ!`
- `আমি ব্যর্থ, আমি loser`

The required Phase 7B/7C transcription and boundary regressions remain passing.

## Rendered MP4 Path

The first Phase 7D UI output was:

`/Volumes/Personal/Cool App/ai-video-editor/app/ai-video-editor/.runtime/projects/project-68fc5d83-0019-4d29-b0ad-716e67fadcaa/output/short-short-project-68fc5d83-0019-4d29-b0ad-716e67fadcaa-0.mp4`

It is not accepted as final Phase 7D evidence because it used the ineffective initial threshold and retained the lower caption zone.

No valid post-threshold Phase 7D MP4 exists.

## Media QA

The first Phase 7D output reported application QA PASS and completed the same media pipeline used by Phase 7C.3. Because the corrected `center-lower` placement was not rendered through the normal UI, no post-threshold media QA result is claimed.

## Frame Review

The before frames confirmed:

- readable Bengali captions;
- valid speaker framing;
- persistent source lower-third/ticker collision in the lower caption zone.

An after frame review cannot honestly be completed until the corrected detector output is produced by a successful normal UI approval and render.

## Human Quality Scores

No final Phase 7D scores are assigned. The existing Phase 7C.3 scores remain historical evidence only; assigning new scores without a corrected post-threshold MP4 would overstate acceptance.

## Remaining Issues

1. The safe-area implementation needs one successful normal UI acceptance render after the threshold correction.
2. Gemini Shorts discovery repeatedly returned candidates that failed the existing complete-thought boundary validator in the final fresh attempts.
3. The original Phase 7D render did not solve the collision because it was produced before the threshold correction.

## Phase 7D.1 — Controlled Rerender Acceptance

### Reused project and legitimacy

The previously approved Phase 7C.3 project was reused without rerunning Gemini or changing its persisted transcript, candidate, approval, or safe boundaries:

- Project: `project-68a40ce7-1db2-49ac-a668-877dcb93b227`
- Source: `https://youtube.com/shorts/lPN9AWaTuEc`
- Source duration: `60.014s`
- Approved Short range: `0.00s–54.848s`
- Existing approval and pre-render evidence remained the source of truth.

The normal UI exposed **Re-export Short** for the completed approved Short. The action archived the previous output, reused the approved Short, and started the existing render job. No project JSON, transcript, candidate, boundary, or workflow approval state was injected.

### Before and after artifacts

- BEFORE: `phase7d-evidence/before-phase7d-caption-placement.mp4`
- AFTER: `.runtime/projects/project-68a40ce7-1db2-49ac-a668-877dcb93b227/output/short-short-project-68a40ce7-1db2-49ac-a668-877dcb93b227-0.mp4`
- Archived by the controlled re-export: `output/revisions/short-short-project-68a40ce7-1db2-49ac-a668-877dcb93b227-0.<timestamp>.mp4`
- Comparable frame sheet generated for review at `/tmp/phase7d1-comparison.jpg` and intentionally not committed as temporary capture output.

### Detector result and source occupancy evidence

The real renderer log reported:

`Caption safe area: center-lower. center-lower zone has no persistent text/graphic occupancy above the safe-area threshold.`

This is the automatic detector decision for the reused source. The lower source lower-third/ticker remains occupied, while the center-lower band provides a stable readable alternative. Captions stayed in that zone for the full clip rather than jumping between zones.

### Before/after frame review

Frames were compared at approximately `1.0s`, `13.7s`, `27.4s`, `41.1s`, and `53.8s`.

- BEFORE: generated captions sat in the lower source area and competed with the persistent lower-third/ticker.
- AFTER: generated captions moved to center-lower, above the persistent lower-third/ticker.
- Bengali text remained readable at all sampled timestamps.
- English/Banglish text remained unchanged and readable.
- The speaker remained visible; no sampled caption block covered the face.
- The center-lower placement stayed inside the 1080×1920 frame with the existing horizontal margins and did not touch Shorts UI edges.
- No new collision with the speaker or another critical source region was observed.

The three earlier fresh Phase 7D projects that failed Gemini boundary validation remain separate upstream failures. They were not used as visual acceptance evidence and were not bypassed.

### Bengali/Banglish verification

The controlled rerender reused the approved caption content, including Bengali Unicode and English code-switching. No text rewrite, translation, or timing change occurred. Existing caption safe-area tests and Phase 7B/7C transcript regressions passed.

### MP4 QA

Independent `ffprobe`/`ffmpeg` validation of the AFTER artifact passed:

- dimensions: `1080×1920`;
- video: H.264;
- audio: AAC, 48 kHz stereo;
- duration: `54.848s`, matching the prior approved safe range;
- video stream present and fully decoded;
- audio stream present and fully decoded;
- application QA: `PASS`;
- no meaningful black or frozen intervals detected in the acceptance review.

### Human quality scores

| Criterion | Score |
|---|---:|
| Caption readability | 9/10 |
| Caption positioning | 9/10 |
| Bengali readability | 9/10 |
| Banglish readability | 9/10 |
| Lower-third collision avoidance | 9/10 |
| Speaker visibility | 9/10 |
| Visual hierarchy | 9/10 |
| Vertical composition | 9/10 |
| Overall visual quality | 9/10 |
| Overall publishability | 9/10 |

### Remaining issues

No Phase 7D.1 caption-placement blocker remains. The source lower-third/ticker is still visible by design, but generated captions no longer materially compete with it. The existing editorial-quality warning about repeated caption-only visual categories is unchanged and is not a safe-area regression.

### Final Verdict

**PASS — PUBLISH READY**
