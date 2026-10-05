# Phase 7C.1 — Multilingual ASR Acceptance Report

## Starting state

Phase 7C remained open because Whisper failed Bengali script and physical-duration checks, while earlier Gemini evidence did not prove the complete normal UI workflow. This phase used the authorized source and the real application UI.

## Test source

- Authorized source: `https://youtube.com/shorts/lPN9AWaTuEc`
- Physical duration: `60.014` seconds, verified by ffprobe
- Imported dimensions: `1080×1918`

## Transcription provider

- Provider: Gemini cloud ASR
- Model: `gemini-3.1-pro-preview`
- Metadata: `gemini-cloud-asr`, `cloud-asr`
- No mock, fixture, transcript injection, or backend state forcing was used.

## Real UI flow

### First UI attempt

The UI completed import and cloud transcription. Gemini returned three candidates, but all were rejected because they were shorter than the enforced 30-second minimum:

| Candidate | Duration | Result |
|---|---:|---|
| `The Helpless King ককক` | `24.16s` | Rejected |
| `Who Do You Ask For Help? কক` | `10.82s` | Rejected |
| `The Burden of the Crown ক` | `18.32s` | Rejected |

A minimal prompt correction required Gemini to include adjacent context when necessary to produce a real physical range of at least 30 seconds. The existing duration validation was not weakened.

### Corrected UI attempt

| Stage | Result |
|---|---|
| New Project | PASS |
| Authorized YouTube import | PASS |
| Physical source probe | PASS — `60.014s` |
| Gemini cloud transcription | PASS |
| Transcript integrity/timing | PASS |
| Gemini Shorts analysis | PASS |
| Candidate review | PASS — one candidate displayed |
| Candidate selected | PASS — `The Helpless King: When Human Power Fails`, viral score `8/10` |
| UI approval | PASS |
| UI render | FAILED — Remotion browser target crashed and the render job remained running |
| Downloaded MP4 from corrected run | NONE |

## Transcript evidence

The real persisted transcript contained native Bengali, including:

- `বললো আপনার কাছে আমাদের কিছু দাবি আছে।`
- `যখন রাজা এই কথা শুনলেন, শোনার পরে রাজা বললেন, আচ্ছা বলো তো কি হইছে, ঘটনাটা কি?`
- `আর রাজা বললেন, সদাপ্রভু যদি তোমাকে রক্ষা না করেন, আমি কোথা থেকে তোমাকে রক্ষা করবো?`

The transcript included the real mixed-language excerpt:

`আমি ব্যর্থ, আমি loser,`

The overall transcript was classified as `mixed`. Segment and provider-returned word timings remained within the verified physical duration; the final returned transcript segment ended before source end.

## Gemini candidate and boundary evidence

Corrected UI candidate:

- Title: `The Helpless King: When Human Power Fails`
- Subtitle: `A powerful story about recognizing the true Provider.`
- Viral score: `8/10`
- Hook note: `Starting with a dramatic dialogue about having 'no power' builds instant curiosity about who is speaking and why they feel so helpless.`
- Candidate range shown by UI: `00:00.0–00:58.3`
- Candidate duration: `58.3s`

The first completed render attempt from the earlier boundary implementation displayed:

- AI suggested: `00:00.0–00:52.0`
- Adjusted: `00:00.0–00:58.5`

Human inspection showed that the adjusted range ended on the incomplete transcript phrase `প্রিয় মন্ডলী, স্ত্রী লোকটি বললেন,`. This exposed a boundary-validator defect: the final transcript segment was treated as a natural boundary even without sentence-ending punctuation.

The validator was corrected so an unterminated final segment is not automatically considered a complete thought. The corrected UI run reached approval, but its render failed before producing an accepted MP4.

## Caption and human review

The earlier MP4 produced before the boundary correction was inspected only as diagnostic evidence and is not accepted as final output. Representative frames showed:

- Bengali captions rendered in readable native script.
- Vertical framing was usable.
- Captions were generally visible and synchronized at sampled timestamps.
- The ending was not publishable because the clip stopped on an unfinished thought.

The corrected run produced no MP4, so final caption sync, audio quality, and publishability cannot be certified.

## Rendered output and media QA

Diagnostic artifact from the pre-correction run:

`/Volumes/Personal/Cool App/ai-video-editor/app/ai-video-editor/.runtime/projects/project-c94c22fa-b10c-4a34-8f69-dfdd42af1a87/output/short-short-project-c94c22fa-b10c-4a34-8f69-dfdd42af1a87-0.mp4`

Its independent ffprobe results were `1080×1920`, H.264 video, AAC audio, and `58.517333s`, with full decode passing. It is not accepted because it was rendered before the final-boundary correction and ended on incomplete speech.

Corrected-run output:

- MP4 path: none
- Resolution/codecs: not applicable
- Complete decode: not applicable
- Black/frozen-frame QA: not applicable

## Phase 7C.2 — Render recovery

### Render failure root cause

The corrected project was approved through the UI, but Remotion's rendering browser crashed while rendering frames 150–157. The server log recorded repeated `The browser crashed while rendering frame ...` messages followed by `Protocol error (Page.bringToFront): Session closed` from `@remotion/renderer`. This identifies the failing process as Remotion's rendering Chromium/session, not the Copilot/Playwright browser controlling the UI. The render job remained stuck at progress `1` with no output artifact.

### Render fix

`src/product-renderer.ts` now performs one controlled recovery attempt after a `renderMedia` failure:

1. Remove only the application-owned temporary output.
2. Log the original Remotion failure.
3. Retry once with `concurrency: 1` to avoid a repeat renderer-browser resource/session failure.
4. Surface an explicit error if the retry also fails.

No global browser processes are killed, and no acceptance guard is weakened.

### Retry/recovery behavior

The fix passed TypeScript validation, but a fresh final UI acceptance could not reach corrected rendering successfully in this session:

- Project `project-5a637494-5a08-4f7d-bf46-57ea8b0a8840` remained in the prior stuck render state and could not legitimately resume.
- A fresh UI project reached transcription, but Gemini returned an invalid word timing (`segment 15, word 9`); the provider correctly rejected it rather than accepting corrupt timing.
- A subsequent UI retry ended with a failed transcript job and no candidate.

### Acceptance project and candidate

The corrected approved candidate remained:

- Project: `project-5a637494-5a08-4f7d-bf46-57ea8b0a8840`
- Title: `The Helpless King: When Human Power Fails`
- Viral score: `8/10`
- UI duration: `58.3s`
- Gemini suggested range: `00:00.0–00:52.0` in the earlier accepted review
- Safe range from the pre-fix run: `00:00.0–00:58.5`

The post-fix boundary validator correctly rejects the earlier incomplete ending instead of certifying it. No corrected MP4 was produced after that fix, so there is no valid post-fix output path, media QA result, or final watched ending to claim.

### Remaining problems

1. The corrected Remotion retry has not yet produced a completed post-boundary-fix MP4 through the normal UI.
2. One fresh UI transcription attempt exposed a provider-returned invalid word timestamp and correctly failed closed.
3. Therefore, no MP4 produced after the final boundary correction has completed independent media QA and human publishability review.

## Regression validation

All required regression checks pass after the prompt and boundary corrections:

- `npm run typecheck`
- `npm run test-phase7b`
- `npm run test-shorts-workflow`
- `npm run test-source-duration-integrity-v1-3-9`
- `npm run test-product-orchestration-v1-3`

## Final verdict

**FAIL**
