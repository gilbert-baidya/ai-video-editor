# AI Video Editor Foundation Architecture Review

Date: 2026-09-07  
Scope: Bangla Director Foundation through Director V4, including the current V4.1 conditional proof branch  
Mode: Read-only senior architecture and code review

## Executive Verdict

Verdict: **CONTINUE AFTER SMALL FIXES**

The foundation has the right architecture and does not need a rewrite. Its strongest boundaries are real: the LLM supplies semantic ranges rather than canonical IDs or timestamps; application code resolves identity and timing; low-confidence Bengali alignment does not authorize word cuts; the reverent policy is deterministic; Remotion consumes an Edit Plan; and unknown-rights media is ineligible for automatic selection.

Before continuing with a positive Director V4.1 proof, fix the bounded V4 rights-cache, metadata-search, orchestration, and proof-visibility issues described below. Before user-facing automated rendering, also enforce approval for AI-authored display text and unverified Scripture references.

No Git history could be reviewed: this repository reports `No commits yet`, and all files are currently untracked. Milestone chronology was therefore reconstructed from the gate reports, proof scripts, and persisted artifacts rather than commits or diffs.

## What Luna Built Well

- **KEEP, P1:** The AI-facing contract is deliberately smaller than the canonical domain contract. It returns segment indices and semantic labels; [resolveSection](../src/director.ts#L123-L142) deterministically assigns IDs, source segment IDs, and source timing.
- **KEEP, P1:** Structured output has strict object, enum, range, confidence, and required-string validation in [validateAIResponse](../src/director.ts#L90-L121), with bounded retries and explicit `ai-success`, `ai-retry-success`, or `deterministic-fallback` outcomes.
- **KEEP, P0:** Timing safety is conservative. [editBoundaryPolicy](../src/alignment.ts#L42-L46) disables word cuts below high confidence and disables sentence cuts at low confidence. Current Edit Plan operations do not contain destructive trim/cut operations.
- **KEEP, P1:** Transcript provenance is explicit: source, provider/model, approval, timing confidence, raw token offsets, and alignment limitations are represented in [contracts.ts](../src/contracts.ts#L200-L299).
- **KEEP, P1:** The V2 retention policy is application-owned and ministry-aware. Calm sections suppress movement and B-roll, while cooldowns and no-change decisions are deterministic in [visual-policy.ts](../src/visual-policy.ts#L86-L129).
- **KEEP, P1:** V3 uses normalized geometry and local macOS Vision. Face, subject, occupancy, title-safe, caption-area, and text-fit evidence remain inspectable in [visual-intelligence.ts](../src/visual-intelligence.ts#L20-L99).
- **KEEP, P0:** V4's final eligibility check is a genuine rights hard gate: `eligible` requires an `owned` or `approved` asset in [broll-selection.ts](../src/broll-selection.ts#L61-L80), and [rightsAllowsAutomation](../src/media-library.ts#L194-L196) rejects `unknown`.
- **KEEP, P1:** Remotion is a renderer, not editorial truth. [Root.tsx](../src/Root.tsx#L36-L61) performs deterministic time-range lookup and rendering from the supplied Edit Plan; it contains no sermon classification or AI call.
- **KEEP, P1:** B-roll video is explicitly muted with `volume={0}` while the original sermon video remains the audio-bearing base layer in [Root.tsx](../src/Root.tsx#L52-L55).
- **KEEP, P2:** The proof artifacts are unusually candid about limitations. Forced alignment remains NO-GO, transcript approval remains false, and V4.1 did not fabricate ownership or a positive result.

## Major Risks

1. **P0, FIX NOW:** Media cache reuse does not include persisted indexer version or rights policy. [isReusable](../src/media-library.ts#L100-L105) recomputes both sides with the current constant and returns the old asset unchanged at [media-library.ts](../src/media-library.ts#L116-L121). A rights downgrade from `approved` to `unknown` can therefore retain stale approval. The V4 proof also applies one `V4_MEDIA_RIGHTS` value to every configured root at [prove-director-v4-local-broll.ts](../scripts/prove-director-v4-local-broll.ts#L15-L21), so approving the proof root also approves `public/`.
2. **P1, FIX NOW:** V4 does not preserve the stated pipeline. The proof maps `SermonAnalysis` directly to B-roll intents and hardcodes `mode: 'full-screen'` at [prove-director-v4-local-broll.ts](../scripts/prove-director-v4-local-broll.ts#L36-L49), bypassing V2 reverent records and V3 placement.
3. **P1, FIX NOW:** A future V4.1 positive result could be selected but not visible. The only eligible illustration is timed 260–340 seconds, while the composition is fixed at 120 seconds in [entry.tsx](../src/entry.tsx#L6-L14). V4 QA checks asset existence, render duration, and mute state, but not operation bounds or visual-frame difference at [prove-director-v4-local-broll.ts](../scripts/prove-director-v4-local-broll.ts#L64-L71).
4. **P1, FIX NOW:** AI-authored `suggestedDisplayText` and unverified Scripture references can become rendered graphics without approval. The flow is [director.ts](../src/director.ts#L123-L155) to [visual-policy.ts](../src/visual-policy.ts#L72-L96) to Edit Plan. `approvedDisplayText` is not consulted, and `verificationStatus: 'needs-review'` is descriptive only.
5. **P1, FIX NOW:** V3 evidence is weaker than its gate report states. Every beat receives the same global frame times `[1, 30, 59]` in [prove-director-v3-visual-intelligence.ts](../scripts/prove-director-v3-visual-intelligence.ts#L19-L64), rather than samples derived from that beat's start/midpoint/end. Also, V3 computes a fitted font size in [visual-intelligence.ts](../src/visual-intelligence.ts#L53-L61), but the renderer always uses the global `graphicFontSize` at [Root.tsx](../src/Root.tsx#L59).

## Contract Review

The central contracts are compact and broadly aligned with the product stages. `SermonAnalysis`, `VideoBeat`, `PlacementDecision`, `MediaAsset`, `BrollDecision`, `EditPlan`, `ArtifactDependency`, and `QAResult` are separate rather than collapsed into a renderer-specific object. Provider attempt types live in the Director adapter rather than the canonical contract file, which is appropriate.

Several impossible or ambiguous states remain:

- **P1, FIX NOW:** `DirectorInput` carries both `transcript` and a separate `segments` array; analysis uses the latter while the Edit Plan hash uses `transcript.originalTranscript` ([director.ts](../src/director.ts#L146-L174), [director.ts](../src/director.ts#L299-L307)). Mismatched inputs can produce an Edit Plan whose provenance hash does not describe the analyzed content. Use the transcript's canonical segments or validate exact equivalence.
- **P2, FIX LATER:** `TranscriptDocument` requires `approvedDisplayText` even when `approved` is false, duplicates `model` and `transcriptionModel`, and uses free-form `language` beside `LanguageProfile` ([contracts.ts](../src/contracts.ts#L282-L299)). This is manageable now but should become a discriminated provenance/approval state before persistence APIs expand.
- **P2, FIX LATER:** `BrollIntent` allows `decision: 'search'` without `search`, and `BrollDecision` allows `decision: 'selected'` without `selectedAssetId` ([contracts.ts](../src/contracts.ts#L151-L186)). Use discriminated unions when this becomes an API boundary.
- **P2, FIX LATER:** `SermonSection.scriptureReference` is an unverified string while `SermonAnalysis.mainPassage` is structured, duplicating the concept with different safety information ([contracts.ts](../src/contracts.ts#L12-L32), [contracts.ts](../src/contracts.ts#L51-L70)).
- **P2, FIX LATER:** `intentFor()` maps most unhandled section types, including Scripture, application, testimony, and transition, to `conclusion` ([director.ts](../src/director.ts#L273-L280)). This weakens the canonical Video Beat vocabulary even though current V4 reads sections directly.
- **P2, FIX LATER:** `speaker-punch-in` exists in the recommendation/layout vocabulary but becomes no operation in V1 and a `center` operation in V2 ([director.ts](../src/director.ts#L299-L305), [visual-policy.ts](../src/visual-policy.ts#L76-L80)). The renderer's punch-in branch is therefore unreachable through the typed operation.
- **P3, FIX LATER:** Schema versions are manually assigned per stage and `FOUNDATION_SCHEMA_VERSION` is not the governing version registry. Keep the strings, but define explicit migration/compatibility rules before files become durable user data.

No renderer-specific React or CSS types leak into the semantic contracts. `GraphicRegion`, normalized rectangles, placement evidence, and B-roll mode are legitimate edit/layout vocabulary, although free-form `style` strings will eventually need versioned presets.

## AI Boundary Review

The principal boundary is correct and should remain. The prompt explicitly prohibits project IDs, source IDs, and timestamps; the application validates numbered segment ranges and resolves all canonical fields. AI does not control file paths, media IDs, project IDs, or pixel coordinates.

- **KEEP, P1:** Parse/schema/range failures are distinguishable from AI success, and retries are bounded with an abort timeout ([director.ts](../src/director.ts#L205-L254)).
- **P1, FIX NOW:** The final provider return is named `deterministic-fallback` but contains no fallback `analysis` ([director.ts](../src/director.ts#L49-L58), [director.ts](../src/director.ts#L254)). Only the proof caller supplies a separate fixture-specific fallback at [prove-director-hardening.ts](../scripts/prove-director-hardening.ts#L49-L75). Make the provider result a truthful failure outcome or guarantee a real deterministic analysis at the boundary.
- **P1, FIX NOW:** AI section arrays are range-validated individually but not checked for ordering, overlap, or duplicate coverage in [validateAIResponse](../src/director.ts#L90-L121). Add deterministic canonical section-set validation before retention/history processing.
- **P2, FIX LATER:** Raw model responses, including `thinking`, are persisted. This is useful evidence locally but should have retention/privacy controls when sermons leave a single-user workstation.

The current single-Director approach is appropriate. There is no agent swarm, and none is needed.

## Transcript/Timing Review

The architecture correctly distinguishes raw Whisper output, an existing-project canonical candidate, AI display suggestions, and an approved-display field. The forced-alignment report correctly refuses word-safe claims, and sentence segmentation preserves enclosing segment bounds rather than interpolating false precision.

- **KEEP, P0:** No current Edit Operation can delete words or cut source media. Low-confidence policy denies word and sentence cuts, and the Director works on segment boundaries.
- **P1, FIX NOW:** Transcript integrity is measured in [transcript-integrity.ts](../src/transcript-integrity.ts#L25-L59) but not enforced by `transcribeAndAlign` or general QA. [createQa](../src/foundation.ts#L166-L179) can accept a wrong-script transcript if it is non-empty and chronologically timed. Integrate integrity status into transcript promotion/QA rather than relying only on proof scripts.
- **P1, FIX NOW:** AI display approval is not enforced per generated label. `approvedDisplayText` is document-wide, initialized to the unapproved source text at [foundation.ts](../src/foundation.ts#L111-L118), and never gates section graphics. Add approval/provenance to generated display content rather than treating canonical transcript immutability as sufficient.
- **P1, FIX NOW:** Unverified Scripture references must not automatically become Scripture cards. Preserve detection, but require verified data or explicit approval before an operation carries Scripture text/reference.
- **P2, FIX LATER:** `immutableOriginal: true` is provenance metadata, not runtime immutability. Hash checks in proofs are useful, but a persistence boundary should enforce append-only revisions or hash verification.
- **P2, FIX LATER:** `editBoundaryPolicy` is not consumed by Edit Plan validation. That is safe only because no destructive operation exists today; any future trim/cut operation must require timing confidence in its validator.

## Director Review

The single semantic Director, strict structured response, retry behavior, and canonical resolver are healthy. Fallback is never mislabeled as AI success; the three-state result makes that visible. Confidence is preserved, not used as a substitute for schema validation.

The main deficiencies are the incomplete fallback contract, missing cross-section order/overlap validation, and unapproved display-text flow described above. `director-placeholder` is a reasonable transitional type, but unresolved placeholders should become an explicit pre-render warning rather than being silently ignored indefinitely (**P2, FIX LATER**).

## Reverent Retention Review

The policy is properly separate from the model. It recognizes calm intensity, suppresses movement/B-roll for reverent sections, permits no change, tracks elapsed calm intervals, imposes speaker and graphic cooldowns, and records every decision with a reason.

- **KEEP, P1:** Prayer, altar call, emotional ministry, and calm sections are protected deterministically rather than by prompt compliance alone.
- **P2, FIX LATER:** The event budget is reported but not enforced except through an events-per-minute warning. Main-point graphics bypass graphic cooldown, and `lastVisualType`/`recentGraphicTypes` are recorded but unused ([visual-policy.ts](../src/visual-policy.ts#L8-L15), [visual-policy.ts](../src/visual-policy.ts#L104-L128)). Add a small deterministic oscillation/repetition rule before full-sermon use.
- **P2, FIX LATER:** The policy assumes analysis sections arrive chronologically. Canonical section-set validation should establish that invariant rather than sorting silently inside the policy.

## Visual Intelligence Review

Normalized geometry, face-first subject construction, body-pose fallback, title-safe regions, caption penalties, suppression, and major-content full-screen fallback are sensible and explainable. Debug overlays and candidate score artifacts are valuable.

- **P1, FIX NOW:** Derive frame samples from each beat's own interval. The current proof labels fixed global samples as beat start/midpoint/end.
- **P1, FIX NOW:** Apply the chosen `textFit.fontSize` in rendering, or validate using the actual renderer font size. Current analysis and output can disagree.
- **P1, FIX NOW:** Empty detector evidence can produce a major-content full-screen decision, and `validatePlacements` only reports missing evidence when the global frame list is non-empty ([visual-intelligence.ts](../src/visual-intelligence.ts#L106-L129)). Treat missing/failed analysis as `review` or a known non-visual fallback.
- **P2, FIX LATER:** V3 cache JSON records hashes but the proof always extracts frames, recompiles Swift, and reruns Vision ([prove-director-v3-visual-intelligence.ts](../scripts/prove-director-v3-visual-intelligence.ts#L60-L79)). Add actual reuse only when long-form processing begins.
- **P2, FIX LATER:** Text fitting counts Unicode code points and assumes 1920px rather than using grapheme clusters and composition dimensions ([visual-intelligence.ts](../src/visual-intelligence.ts#L53-L61)). This is conservative for many Bengali conjuncts but not typographically exact.

## B-Roll Review

The V4 concepts are correctly separated: index, intent, candidate score components, usage history, decision, and render operation. Unknown rights cannot win merely through semantic score. No web, stock, or generated-media provider has been added.

- **P0, FIX NOW:** Include indexer version, root identity, and rights policy in cache reuse; on reuse, recompute policy-derived fields or reject stale records. Add an approved-to-unknown downgrade test.
- **P1, FIX NOW:** Configure rights per root/manifest, not one environment value copied to every root. Mixed approved and unknown libraries are a core requirement, not an edge case.
- **P1, FIX NOW:** `termsForPath()` accepts only ASCII letters/digits at [media-library.ts](../src/media-library.ts#L69-L90), while the search intent is Bengali. `description` is never populated and no sidecar is read. Consequently an owned asset with a Bengali filename cannot obtain a semantic match through the current indexer. Add Unicode tokenization and a small explicit metadata manifest/sidecar; do not replace the search framework.
- **P1, FIX NOW:** Route selected media through reverent retention and visual placement instead of hardcoding full-screen mode.
- **P1, FIX NOW:** Make the positive proof use a source/analysis window containing the selected moment, validate operation bounds, capture a frame during B-roll, and verify a visible difference from control.
- **P2, FIX LATER:** `avoidTerms` and `allowUnknownRights` are currently unused. The hard rights gate is correct; either remove the latter or make its review-only semantics explicit without weakening automation.
- **P2, FIX LATER:** The proof creates an empty usage history and never appends selections, so rapid reuse is modeled but not demonstrated ([prove-director-v4-local-broll.ts](../scripts/prove-director-v4-local-broll.ts#L36-L49)).
- **P2, FIX LATER:** Video duration/offset behavior is not validated. A conditionally mounted Remotion `Video` is not wrapped in an operation-relative sequence, and candidate suitability does not ensure sufficient duration.

## Cache Review

The dependency vocabulary is good, but only media stat reuse is implemented. Most other “cache” files are manifests written after recomputation, not cache readers.

| Change | Intended invalidation | Current evidence |
| --- | --- | --- |
| Font/theme | Render only | Correctly represented in foundation/V2/V3 artifacts; no general cache executor |
| Transcript text | Sentence segmentation and all semantic/edit/render descendants | Correct list in [transcriptInvalidates](../src/transcript-integrity.ts#L86-L90), but helper is proof-only |
| Transcript timing | Analysis/edit/captions/render | Declared, not orchestrated |
| AI provider/model/prompt | Semantic Director and downstream only | Hashes recorded by hardening proof; no cache lookup |
| Retention policy | Retention/placement/Edit Plan/render | Policy hash recorded; no cache lookup |
| Safe-zone algorithm/detector | Visual analysis or placement downstream | No algorithm/config version governs reuse; V3 always recomputes |
| Media file | That asset, media search, Edit Plan/render if selected | Actual stat cache exists; content hash is optional and unset |
| Rights metadata | Media eligibility/search/Edit Plan/render | Incorrectly reusable today; P0 finding |

- **P1, FIX NOW:** Correct the media cache safety bug and stop describing indexer-version invalidation as proven until tested.
- **P2, FIX LATER:** Introduce a small stage runner that validates `ArtifactDependency` input hashes/versions before reuse. Do not build a distributed cache or workflow engine yet.
- **P2, FIX LATER:** Exclude volatile `updatedAt` from semantic index hashes; otherwise identical reused indexes hash differently every run.
- **P2, FIX LATER:** Populate `contentHash` lazily for stronger change detection where file-system timestamp/size are insufficient.

## Job Architecture

The `Job` contract already supports queued, running, completed, failed, and cancelled states, progress, errors, and artifact paths ([contracts.ts](../src/contracts.ts#L465-L478)). Modules are mostly stateless functions with serializable inputs/outputs, so later queue migration is feasible.

**P2, FIX LATER:** Retry count, stage/checkpoint identity, cancellation signal, dependency keys, and resumable stage outputs are absent. Add them when the first real long-running orchestrator is built, not as an abstract framework now. Current proof scripts are sequential and synchronous, so they are not themselves resumable jobs.

## Rendering Review

Remotion correctly remains downstream of the Edit Plan. The composition does not infer sermon meaning. It supports source video, framing, cards, graphics, captions, images, and muted video B-roll with straightforward deterministic rendering.

- **P1, FIX NOW:** Align renderer behavior with V3 text-fit decisions and validate selected media can actually be loaded before marking an Edit Plan validated.
- **P2, FIX LATER:** `validatePlan` rejects every overlap except captions ([foundation.ts](../src/foundation.ts#L143-L156)), while split B-roll plus speaker framing may legitimately overlap. Define legal operation-layer combinations before split mode is used.
- **P2, FIX LATER:** The composition is fixed to 120 seconds, 1920x1080, and 30fps. That is appropriate for proofs but must become project/source metadata before a full-length milestone.
- **P2, FIX LATER:** Absolute media paths and `public/` prefix handling in [mediaSource](../src/Root.tsx#L36-L38) are not yet a robust asset-serving boundary. Keep Remotion, but resolve assets through a validated render manifest.

## Bangla Review

Bangla is genuinely first-class in normalization, script measurement, Bengali punctuation, Noto Sans Bengali rendering, fixture content, and grapheme regression checks. The review rejects the suggestion that Bengali requires RTL layout; Bengali is left-to-right.

- **KEEP, P1:** NFC normalization preserves authoritative display strings while normalizing only for matching in [alignment.ts](../src/alignment.ts#L14-L40).
- **KEEP, P1:** The transcript-integrity comparison correctly rejected Devanagari/malformed Whisper output and retained the Bengali existing-project candidate.
- **P1, FIX NOW:** Enforce integrity status at promotion/QA rather than only in the proof.
- **P1, FIX NOW:** Make media filename/tag tokenization Unicode-aware so Bengali asset metadata participates in matching.
- **P2, FIX LATER:** Sentence splitting handles Bengali danda, question, and exclamation punctuation but not an English period, reducing mixed-language segmentation quality ([transcript-integrity.ts](../src/transcript-integrity.ts#L62-L79)).
- **P2, FIX LATER:** Use grapheme-aware text measurement and the actual rendered font metrics for final layout. Keep the current heuristic as a fast preflight.

## Long-Form Scaling Review

The current evidence covers a 400-second semantic fixture and 120-second renders. The 400-second fixture contains 20 segments and 4,534 transcript characters; its persisted transcript artifact is about 52 KB. This does not show a current JSON-memory problem, but it does not validate 35–40 minutes.

Concrete constraints are:

- The Remotion composition cannot exceed 120 seconds today.
- The Director sends the complete numbered transcript in one prompt and retries the complete request. This is simple and acceptable at current size, but needs one real full-sermon context/runtime measurement before adoption.
- V3 extraction and Vision execution are sequential and always recomputed; per-beat sampling can remain sparse, but must use correct beat-relative times.
- Every media search scans every asset. Keep this until a measured library size makes it slow.
- FFmpeg/Whisper child processes have no timeout or cancellation connection, which will complicate job cancellation and hung-process recovery.

**P2, FIX LATER:** Run one full-length dry semantic pass and one representative long render after the FIX NOW items. Do not preemptively introduce streaming JSON, vector databases, segmented rendering, or an agent swarm without measured need.

## Security Review

- **KEEP, P1:** Process execution uses `execFile` with argument arrays rather than shell interpolation in [foundation.ts](../src/foundation.ts#L17-L21), substantially reducing command-injection risk.
- **P2, FIX LATER:** FFmpeg, ffprobe, and whisper paths are hardcoded to local Homebrew locations. Make tool paths configurable and validate availability for portability; this is not a P0 security issue in the current local prototype.
- **P2, FIX LATER:** Media roots and output paths accept arbitrary local paths. Before exposing server/API input, canonicalize and allowlist roots, prevent output escape, set process timeouts, and cap media size/duration.
- **P2, FIX LATER:** Raw AI responses and absolute local paths are persisted in artifacts. Add retention/redaction policy before multi-user or cloud execution.
- **KEEP, P2:** No secrets are embedded, no shell command strings include user-controlled interpolation, and the Director defaults to local Ollama.

## Licensing Review

No production source import from either `research/` or SermonClip Studio was found. Proof scripts read SermonClip transcript/media files by path as read-only fixtures; that is data coupling, not copied runtime code. The direct npm dependency surface is Remotion plus TypeScript tooling.

- **P2, FIX LATER:** Remotion 4 uses a two-tier license, not a plain MIT assumption. [Its bundled license](../node_modules/remotion/LICENSE.md#L9-L37) is free for individuals, nonprofits, evaluation, and for-profit organizations up to three employees; larger for-profit use requires a company license. Confirm entity eligibility before commercial deployment.
- **P2, FIX LATER:** Continue tracking FFmpeg/whisper binaries, model weights, and fonts separately from npm packages. The forced-alignment report correctly rejected or quarantined candidates with unsuitable or unclear model licenses.
- **KEEP, P1:** No uncertain-source research implementation is linked into production code.

## Testing Review

The proof suite validates meaningful behavior: malformed model output caused fallback in V1, structured output passed three repeated real runs, transcript hashes remained unchanged, segment-safe boundaries were retained, Unicode graphemes were checked, V2 rendered control/director frames, V3 exercised placement/suppression/fallback, V4 rejected unknown rights, and media cache reuse was observed.

Critical gaps:

- No forced test makes the current provider exhaust retries and verifies a complete fallback analysis.
- No test rejects overlapping/out-of-order AI section ranges.
- No test proves an unapproved display label or unverified Scripture reference cannot render.
- Transcript integrity is not part of general QA.
- V3 samples are not beat-relative and fitted font size is not checked against rendered pixels.
- No cache mutation matrix tests model/version, rights downgrade, file modification, policy change, detector change, or presentation-only change.
- V4 has no positive selected/rendered asset proof, no selected-frame pixel evidence, and no operation-range validation.
- No full-length performance or cancellation/resume test exists.

The scripts are useful executable proofs, but they are not yet a regression test suite: most write shared artifacts, depend on local binaries/models/source repositories, and lack isolated assertions for failure paths.

## Findings Table

| ID | Area | Finding | Severity | Classification | Recommended Action |
| --- | --- | --- | --- | --- | --- |
| F-01 | Media rights/cache | Reused assets retain stale rights; indexer version is not actually compared; one env rights value applies to all roots | P0 | FIX NOW | Include root/right/version inputs in reuse and test approved-to-unknown downgrade |
| F-02 | V4 architecture | V4 bypasses reverent retention and V3 placement, hardcoding full-screen operations | P1 | FIX NOW | Compose existing policy and placement stages; do not redesign them |
| F-03 | V4 proof | 260–340s operation cannot appear in a fixed 120s render; QA lacks bounds/visible-difference checks | P1 | FIX NOW | Align source/analysis windows and assert an in-range visible frame |
| F-04 | Media search | ASCII-only indexing and absent descriptions prevent normal Bengali metadata matching | P1 | FIX NOW | Add Unicode tokenization and explicit local metadata/rights manifest support |
| F-05 | Content approval | AI display text and `needs-review` Scripture can become rendered graphics | P1 | FIX NOW | Require per-display approval/provenance and verified/approved Scripture |
| F-06 | Director fallback | `deterministic-fallback` result can contain no analysis; fallback exists only in a proof caller | P1 | FIX NOW | Return a complete fallback analysis or name it a provider failure |
| F-07 | Canonical input | Director can analyze `input.segments` while hashing a different transcript | P1 | FIX NOW | Remove duplicated segments input or validate identity/content equality |
| F-08 | Visual evidence | V3 uses identical fixed sample times for every beat | P1 | FIX NOW | Derive start/mid/end samples from each beat interval |
| F-09 | Text placement | Computed fitted font size is not consumed by Remotion | P1 | FIX NOW | Render the decision font size or score the actual configured size |
| F-10 | Transcript QA | Script/integrity status is not enforced during ingestion or general QA | P1 | FIX NOW | Gate canonical promotion and QA on integrity result |
| F-11 | State/QA | Plans are labeled `validated` before validation, and pre-render QA may have top-level `passed: true` while render is false | P1 | FIX NOW | Make status transitions and aggregate QA internally consistent |
| F-12 | Cache | Most cache files are dependency reports, not executable reuse/invalidation | P2 | FIX LATER | Add a small hash/version-aware stage runner before long-form processing |
| F-13 | Contracts | B-roll and transcript approval contracts permit contradictory optional-field states | P2 | FIX LATER | Introduce discriminated unions at durable API/persistence boundaries |
| F-14 | Director semantics | Several section types collapse to `conclusion`; punch-in is not representable end to end | P2 | FIX LATER | Complete existing mappings without adding new abstractions |
| F-15 | Retention | Budget is advisory; repetition history fields are unused | P2 | FIX LATER | Enforce a modest event/repetition rule for full sermons |
| F-16 | Visual fallback | Missing detector evidence can silently become full-screen fallback | P1 | FIX NOW | Return review/known fallback and require evidence in validation |
| F-17 | B-roll behavior | Reuse history, avoid terms, video duration, and operation-relative playback are unproven | P2 | FIX LATER | Add focused tests before enabling repeated/video B-roll |
| F-18 | Long form | Composition is fixed at 120s and no 35–40 minute run exists | P2 | FIX LATER | Parameterize composition metadata and run one measured long-form proof |
| F-19 | Job model | Contracts are queue-compatible but lack retry/checkpoint/cancellation plumbing | P2 | FIX LATER | Add with the first real job orchestrator, not now |
| F-20 | Portability/security | Tool paths and media roots are trusted local strings without timeout/allowlist | P2 | FIX LATER | Configure tools and sandbox paths before server/multi-user exposure |
| F-21 | Licensing | Remotion entity-size licensing and binary/model/font provenance need deployment review | P2 | FIX LATER | Maintain a deployment dependency/license inventory |
| F-22 | Test structure | Proofs cover core happy paths but not critical rejection/invalidation paths | P1 | FIX NOW | Add focused deterministic tests for the listed safety boundaries |
| F-23 | Core architecture | Semantic Director, deterministic resolver, retention, Edit Plan, renderer boundary, and rights gate are sound | P1 | KEEP | Preserve these modules and their responsibilities |
| F-24 | Timing safety | Segment-safe fallback and absence of destructive operations prevent false word-level editing claims | P0 | KEEP | Do not add cuts until a verified aligner and validator exist |

No finding warrants **REDESIGN**.

## FIX NOW List

1. Repair media cache/version/rights invalidation and configure rights per root.
2. Make V4 use retention plus visual placement, and make its positive proof in-range and visibly asserted.
3. Add Unicode-aware asset metadata so a real Bengali intent can select a relevant approved asset.
4. Enforce approval for AI display text and unverified Scripture before creating renderable operations.
5. Correct Director fallback/input invariants and section-order validation.
6. Correct V3 beat-relative sampling, renderer text-fit usage, missing-evidence handling, and core QA state consistency.
7. Put transcript integrity into canonical promotion/general QA and add deterministic rejection/cache-mutation tests.

These are bounded corrections to existing modules, not an architecture rewrite.

## FIX LATER List

- Convert ambiguous B-roll/transcript states to discriminated unions when APIs stabilize.
- Implement executable stage caching and resumable job metadata before long-form processing.
- Complete Video Beat intent and punch-in mappings.
- Enforce full-sermon event/repetition budgets after measuring real sermons.
- Add grapheme/font-metric layout refinement, mixed Bangla-English period segmentation, and caption collision tests.
- Validate video B-roll duration and operation-relative playback.
- Parameterize duration/resolution/fps and run a measured 35–40 minute proof.
- Configure tool paths, timeouts, and path allowlists before server exposure.
- Confirm Remotion and model/binary/font licensing before commercial deployment.

## Things We Should NOT Rewrite

- The canonical transcript and provenance model; tighten enforcement around it.
- The semantic-only AI contract using numbered source segments.
- The deterministic canonical resolver and explicit provider outcome labels.
- The single Director architecture; do not introduce an agent swarm.
- The four-level visual intensity vocabulary.
- The reverent retention policy, cooldown concept, and first-class no-change behavior.
- The normalized visual geometry and local macOS Vision analyzer.
- The safe-zone scoring/explanation artifact shape.
- The local media index and explainable weighted candidate scoring.
- The `owned`/`approved` hard eligibility gate and explicit `unknown` state.
- The Edit Plan as canonical editorial output.
- Remotion as a deterministic downstream renderer.
- The milestone proof/gate discipline and refusal to overclaim forced alignment or media ownership.

## Recommended Next Milestone

Director V4.1 **may proceed after the small V4-specific FIX NOW items F-01 through F-04 are corrected**. Do not add stock, web search, generated media, a new search framework, or a media UI. Then place one genuinely owned/approved illustrative asset in the existing proof library and rerun a corrected positive-selection proof through retention, ranking, rights, technical checks, visual placement, in-range Edit Plan generation, visible render evidence, no-B-roll control, and second-run cache reuse.

Until then, retain the current V4.1 result: **CONDITIONAL GO — APPROVED ASSET REQUIRED**. The architecture is safe to continue; the current positive-proof harness is not yet strong enough to award GO.
