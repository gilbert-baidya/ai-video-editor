# Bangla Transcript Integrity Gate

## Current Problem

The previous 120-second proof forced Whisper language `bn`, but the raw Whisper JSON itself was not consistently Bangla script. The small-model output measured 0% Bengali script and 92.67% Devanagari letters, with repeated phrases. The medium-model comparison also measured 0% Bengali script and 87.33% Devanagari letters, plus replacement characters and repeated output. A language flag selects the decoding language; it does not prove that every emitted Unicode character is valid Bangla or that the semantic transcript is accurate.

## Current Pipeline

The exact fixture is `artifacts/foundation-sample/audio.wav`, extracted from source window 4020-4140 seconds. `ffprobe` reports 120 seconds, mono PCM signed 16-bit little-endian, 16 kHz. The local binary is `/opt/homebrew/bin/whisper-cli`, whisper.cpp 1.9.2, running on Apple Silicon Metal. The existing path invokes:

```text
/opt/homebrew/bin/whisper-cli -m <model> -f artifacts/foundation-sample/audio.wav -oj -ojf -l bn -of <output-base>
```

The model is `ggml-small.bin` (487,601,967 bytes). The output is whisper.cpp JSON with `transcription` segments, millisecond offsets, text, and token offsets/probabilities. Language detection was not enabled as an automatic decision; `-l bn` forced Bangla decoding. Translation was not enabled because the task remained transcription. No prompt or initial context was supplied. No explicit condition-on-previous-text disabling flag was supplied, so whisper.cpp defaults applied. The observed decoder log reported 5 beams plus best of 5. No post-processing changed the raw script; the Devanagari result is present in `artifacts/foundation-sample/whisper.json`.

## Transcript Sources

The comparison uses the same audio window and three sources:

| Source | Provenance | Role |
| --- | --- | --- |
| Whisper small | New local ASR output, `ggml-small.bin` | Diagnostic and future fallback only |
| Whisper medium | New local ASR output, `ggml-medium.bin` (1,533,763,059 bytes) | Controlled comparison only |
| SermonClip persisted transcript | Existing project transcript, six segments covering 4020-4140 | Bengali reference and initial canonical candidate |

No manually corrected transcript was found in the inspected project inputs. The persisted transcript is not treated as perfect ground truth; semantic accuracy still requires Bengali listening review.

## Candidates Tested

The small model is the current path. The medium model was run with the identical audio and flags. Medium completed in 49.413 seconds, approximately 0.412x real time, but produced a long repeated non-Bengali block and replacement characters. The existing IndicConformer-backed SermonClip transcript was not rerun as a new ASR candidate; its persisted Bengali output was measured as the reference source. No cloud API, paid API, faster-whisper runtime, or large new model was introduced.

## Bangla Script Integrity

The reproducible artifact is `artifacts/transcript-integrity/transcript-integrity-gate.json`. Script percentages below are calculated over Unicode letters, while raw character and replacement counts are also retained:

| Candidate | Bengali | Devanagari | Latin | Unknown/other | Replacement | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Whisper small | 0% | 92.67% | 0% | 7.33% | 0 | REVIEW |
| Whisper medium | 0% | 87.33% | 0% | 12.67% | 2 | REVIEW |
| SermonClip persisted transcript | 100% | 0% | 0% | 0% | 0 | PASS |

The integrity check also reports empty segments, repeated phrase runs, suspicious script switches, replacement characters, and unknown letters. Unexpected Indic script is a warning/failure condition for a primarily Bangla transcript, while Latin code-switching is measured and permitted.

## Transcript Quality

Script integrity is materially better in the persisted SermonClip transcript. The Whisper outputs are not promoted because they change the script, include obvious repeated or malformed output, and cannot be assumed semantically equivalent to the persisted Bengali text. Bible names, Bangla-English code switching, phrase completeness, and meaning have not been scored automatically. **HUMAN LANGUAGE REVIEW REQUIRED.** The persisted transcript is a reference, not unverified ground truth.

## Runtime

The exact 120-second sample is 3,840,078 bytes as 16 kHz mono WAV. Small-model timing already exists in the foundation artifact. Medium used 1.534 GB on disk and completed in 49.413 seconds on the local Apple Silicon Metal runtime. The medium run did not improve script integrity enough to justify its cost as the canonical path.

## Recommended Transcript Strategy

Use Option B initially: existing SermonClip transcript plus new timing metadata. The generated `artifacts/transcript-integrity/canonical-transcript-candidate.json` records `textSource: existing-project`, `approved: false`, `timingConfidence: segment-safe`, and empty word arrays. This keeps Bengali text intact without silently replacing it with ASR output. A future `manual` or `hybrid-reviewed` transcript can be promoted through the same contract after review.

The provenance contract now records `textSource`, provider/model metadata, `approved`, and timing confidence. The protected flow remains raw ASR, reviewed/authoritative transcript, AI-suggested display text, and approved display text. Local ASR remains diagnostic or fallback input; it cannot become authoritative merely by running successfully.

## Sentence Segmentation

`buildTranscriptSentences()` recognizes Bengali দাঁড়ি `।`, question marks, and exclamation marks. When punctuation separates multiple units, it creates sentence records but retains the enclosing source segment bounds rather than interpolating word or sentence offsets. When a source segment has no trustworthy internal boundary, it creates one low-confidence sentence unit for the segment. The six source units in this fixture therefore remain segment-safe timing, not fabricated sentence precision.

The supported timing hierarchy is:

```text
word-safe      disabled
sentence-safe  review until sentence boundaries are audibly confirmed
segment-safe   supported fallback
review         required for uncertain units
```

## Safe Editing

The proof artifact contains six real ranges from the fixture, each covering one complete persisted source segment: `[0,20]`, `[20,40]`, `[40,60]`, `[60,80]`, `[80,100]`, and `[100,120]` seconds relative to the sample. They are safe segment ranges in the data model, but automatic audio clipping and semantic completeness are not claimed without listening. Every range is marked **HUMAN LANGUAGE REVIEW REQUIRED**. Word-level destructive editing remains disabled. Sentence-level editing remains review-gated until internal boundaries are verified.

## Caption Suitability

Sentence, phrase, and segment captions are supported using preserved source text and enclosing segment timing. Karaoke-style word highlighting is disabled. This is suitable for long-form sermon captions once a Bengali reviewer confirms the text and caption breaks. The existing Remotion renderer, Edit Plan, cache model, and QA remain unchanged in behavior.

## Limitations

- The persisted SermonClip transcript has not been manually certified against the audio.
- Automatic script analysis cannot judge Bangla pronunciation, names, theology, or semantic completeness.
- Source segments are broad 20-second units; sentence boundaries inside them are not proven.
- No full 35-40 minute pipeline was run.
- No forced alignment or word timing was reintroduced.
- No new external model or paid service was used.

Transcript text changes invalidate sentence segmentation, sermon analysis, affected Edit Plan decisions, captions, and render. Timing changes invalidate sermon analysis, Edit Plan, captions, and render. Presentation-only changes invalidate render. Source-media changes invalidate audio and all downstream artifacts; transcript correction does not re-extract audio or re-import video.

## Recommendation

**CONDITIONAL GO**

The product may proceed to the sentence/segment-safe Director foundation after Bengali human review. The canonical starting path is the existing SermonClip Bengali transcript with explicit unapproved provenance and segment timing. Local Whisper remains available for diagnostics and fallback, but its Bangla-labeled output is currently script-corrupted on this fixture and must not overwrite the protected transcript. Word-level destructive editing remains disabled.