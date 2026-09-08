# Bangla Forced-Alignment Proof

## Baseline

This proof uses the exact existing 120-second fixture, source window 4020-4140 seconds, and `artifacts/foundation-sample/audio.wav`. The authoritative Bengali transcript is the six-segment transcript from the read-only SermonClip source project. It contains 292 whitespace-delimited words. The existing Whisper result contains 826 timing tokens, but its recognized text is not authoritative Bengali text and is therefore retained only as a timing fallback.

The required contract is: authoritative transcript plus audio, Bengali forced alignment, mapping back to the unchanged authoritative transcript, confidence, and safe editing boundaries. No full-sermon pipeline was run.

## Candidates

| Candidate | What was verified | Result |
| --- | --- | --- |
| Whisper token timing | Existing provider and raw-token audit | Preserved as fallback; recognition output is not forced alignment |
| sherpa-onnx Bengali Zipformer | Ran on the exact 120-second audio; 807 timestamped tokens; 2.389 seconds; RTF 0.0199 | Streaming ASR emission timing, not known-transcript forced alignment |
| Local IndicConformer Bengali ONNX | 197,595,578-byte ASR model exists with Bengali tokens; no local ONNX runtime or CTC posterior extraction was available | Not demonstrated as a forced aligner |
| CTC segmentation | Algorithm requires frame-level CTC posteriors from a compatible Bengali acoustic model | Not runnable with the local dependency set |
| WhisperX | Alignment architecture and license reviewed; Bengali phoneme model availability was not established | Not selected |
| MFA | Mature forced-aligner architecture reviewed; Bengali acoustic model and license were not verified locally | Not selected |
| MMS | Official documentation describes multilingual forced-alignment tooling and 1,130-language alignment coverage | Rejected for production because code and weights are CC-BY-NC-4.0 |

## Licensing

MMS is not acceptable for this production path because its official repository states that code and model weights are CC-BY-NC-4.0. The local Zipformer bundle has no license statement in its bundled README and is reference/test only. Hugging Face Bengali wav2vec2 search results exposed ASR checkpoints with incomplete or absent model cards; no candidate was promoted without a verified commercial license and local runtime.

## Selected Provider

No production Bengali forced-alignment provider was selected. The current `AlignmentService` abstraction remains intact. Whisper token timing remains available, and segment-safe fallback remains the only safe provider when no verified word-level alignment exists.

## Architecture

`AlignedWord` now carries immutable `originalText`, optional `normalizedMatchText`, optional timing, confidence, source, and match status. Sources are explicitly `forced-alignment`, `whisper-token`, or `segment-fallback`. Match statuses are `exact`, `normalized`, `approximate`, and `unmatched`.

The mapping function never replaces authoritative text with recognizer text. Bengali normalization uses NFC, removes punctuation for matching, converts Bengali digits to ASCII digits for matching only, collapses whitespace, and preserves the original string for captions and exports.

## Bengali Mapping

The same-fixture proof generated `artifacts/foundation-sample/authoritative-word-mapping-proof.json`. It confirms:

- 292 authoritative words and six source segments.
- The authoritative transcript is preserved.
- Normalization examples include `যোহন ১৫:৫` and `যোহন 15:5` without changing displayed text.
- The current fallback has 292 exact text mappings, confidence `0`, and no invented word offsets.
- Fallback segment boundaries are `[0,20]`, `[20,40]`, `[40,60]`, `[60,80]`, `[80,100]`, and `[100,120]` seconds relative to the fixture.

## Timing Quality

The segment fallback intentionally reports 0% word alignment and 100% segment fallback. It has no negative durations, zero-duration word spans, overlaps, or chronological violations because it does not claim word spans. The Zipformer benchmark reports monotonic token timestamps, but those timestamps belong to independently recognized output and cannot be mapped to the authoritative transcript as forced alignment.

## Manual Validation

No word-level candidate was produced, so no word is marked as audibly validated. Human listening review remains required for any future provider before enabling word cuts. Existing caption and alignment audits remain valid for their existing providers and were not reclassified as Bengali forced-alignment evidence.

## Cut Safety

Word cuts are disabled. The current policy permits segment boundaries when confidence is low and requires review for low-confidence alignment. The segment-safe proof remains the governing editing proof. A future provider must prove authoritative mapping, confidence thresholds, monotonic non-overlapping spans, and human spot checks before destructive word cuts can be enabled.

## Caption Timing

The existing Remotion renderer, caption operations, cache model, Edit Plan, and QA are preserved. Whisper token timing can continue to support caption timing experiments, while the authoritative Bengali transcript remains the displayed source. No unverified word timing is injected into the renderer.

## Performance

The local Zipformer ASR benchmark completed the 120-second fixture in 2.389 seconds, RTF 0.0199, with 807 tokens and monotonic timestamps. This is useful operational evidence for fast ASR fallback only. No forced-alignment runtime performance was measured because no licensed, locally runnable provider passed the candidate gate.

## Fallback Behavior

The safe hierarchy is: verified forced-alignment spans mapped to unchanged authoritative words; otherwise preserved Whisper token timing for non-destructive caption experiments; otherwise segment boundaries with review required. Independent ASR text must never silently overwrite the authoritative transcript or authorize word cuts.

## Recommendation

**NO-GO**

The requested production-usable Bengali forced-alignment provider was not demonstrated on the exact 120-second fixture. The implementation is ready to accept one behind the existing abstraction, but this milestone does not authorize Bengali word-level editing. The next proof should supply a licensed Bengali CTC or phoneme model, a reproducible local runtime, posterior-based known-transcript alignment, and human audio spot checks on the same fixture before reconsideration.