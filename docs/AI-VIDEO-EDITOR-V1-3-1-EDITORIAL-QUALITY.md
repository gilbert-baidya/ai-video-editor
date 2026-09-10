# AI Video Editor V1.3.1 — Editorial Quality Recovery

**IMPLEMENTATION: COMPLETE**

**OFFICE TESTS: PASS**

**REAL VIDEO RERENDER: PERSONAL-MAC-PENDING**

Editorial quality is not declared GO until the same real Short is rerendered and judged on the personal Mac.

## Failure found

V1.3 proved engineering orchestration, but the audited 60-second result exposed a separate editorial failure:

- a 1080×1918 portrait source inherited a 1920×1080 output;
- unconditional source `cover` fitting cropped portrait framing;
- functional review actions could become creative state;
- B-roll recommendations became `keep-current` before review;
- speaker-full and punch-in recommendations could disappear;
- no deterministic audit compared approved and renderer operations;
- technical QA could pass a nearly static edit.

V1.3.1 treats engineering validity and editorial quality as independent gates.

## Aspect-ratio root cause and recovery

The product previously initialized every project as 1920×1080 and did not replace that assumption from authoritative source dimensions.

`VideoFormatProfile` now records:

- source and output aspect ratios;
- portrait or landscape orientation;
- output width and height;
- non-destructive fit mode;
- normalized safe zones.

Effective dimensions include ffprobe rotation/display-matrix metadata. Sources with 90° or 270° rotation swap encoded width/height before orientation selection.

Deterministic output:

| Source | Output |
| --- | --- |
| Obvious portrait, including 1080×1918 | 1080×1920 portrait |
| Obvious landscape, including 1280×720 | 1920×1080 landscape |

If effective dimensions cannot be established, ingest is blocked. The product does not silently retain a landscape default.

## Source framing

The authoritative source now uses the profile's `contain` fit rather than unconditional `cover`. Matching portrait/portrait and landscape/landscape sources preserve normal framing. Slight source/output ratio differences produce non-destructive padding rather than accidental crop.

Speaker-left, speaker-right, and punch-in remain explicit editorial transformations. Static/full framing has no hidden default zoom.

## Dynamic Remotion composition

Source metadata updates the project render configuration. The format profile flows through:

```text
ffprobe effective dimensions
  -> project render configuration
  -> Remotion input props
  -> calculateMetadata width/height
  -> final output metadata
```

Legacy proof compositions retain an explicit landscape default, but the production product path supplies the source-derived profile.

## Functional review isolation

Review state now carries an explicit purpose:

- `editorial`
- `functional-test`

The product host rejects `functional-test` state. Browser recovery also refuses it. Functional Review Workspace tests use an isolated fixture and cannot be persisted as creative project state.

More importantly, the host no longer trusts client-supplied readiness, blockers, or approved plan. It loads the persisted Director workspace, verifies the plan hash, derives the approved plan, reevaluates readiness, validates realization, and writes authoritative artifacts itself.

## Director → policy → review → renderer contract

Supported decisions are represented explicitly:

| Director decision | Policy/approved operation | Renderer |
| --- | --- | --- |
| `speaker-full` / `none` | `no-change` | Explicitly realized static source |
| `speaker-left` / `speaker-right` | `speaker-position` | Source transform |
| `speaker-punch-in` | `speaker-position: punch-in` | Source transform |
| `caption` | `caption` | Caption overlay |
| sermon point/title | `sermon-point` | Graphic overlay |
| Scripture | scripture-styled `sermon-point` | Scripture graphic |
| resolved B-roll | `broll` | Rights-safe media layer |
| unresolved B-roll | `director-placeholder` | Review blocker; never rendered silently |

Each review save persists:

- `review.json`
- `approved-plan.json`
- `plan-realization.json`
- `operation-trace.json`

The trace records Director decision, policy decision, review outcome, approved operation, and renderer mapping.

Human-approved display text is applied to the approved caption/graphic operation with `approved-display` trust before rendering.

## B-roll contract

B-roll is no longer converted to `keep-current` by policy.

- A recommendation becomes an explicit review-required placeholder.
- If a rights-safe, usable indexed asset is chosen, review converts it to a `broll` operation.
- Review validates the asset currently referenced by the replacement operation—not a stale original selection.
- Missing, unusable, unknown-rights, or unresolved B-roll remains a blocker.
- The reviewer may select another eligible asset, reject the operation, or choose **Keep Pastor — Static**.
- The renderer refuses approved B-roll if its media cannot be mapped without loss.

## Keep Pastor

Keep Pastor is persisted as a distinct `keep-pastor-static` review resolution and an explicit approved `no-change` operation. It is not inferred from free-form reason text and is not conflated with ordinary rejection.

Reverent prayer, Scripture, altar-call, and emotionally sensitive sections remain eligible for calm speaker-led treatment. Ordinary teaching and story sections can still use restrained reframes, captions, graphics, or B-roll.

## Director/policy balance

The Director prompt now states:

- Reverent Retention is not visual inactivity.
- Ordinary teaching, stories, questions, and emphasis may use restrained captions, sermon points, punch-ins, reframes, Scripture treatments, contextual B-roll, or visual resets.
- Constant short-form cuts remain undesirable.

Policy preserves no-change decisions explicitly, retains punch-ins, and routes B-roll to review instead of suppressing it.

## Meaningful edit model

`MeaningfulEditEvent` classifies:

- layout changes;
- B-roll;
- Scripture cards;
- sermon-point graphics;
- captions;
- reframes;
- title treatments;
- visual resets.

Canonical no-change operations count toward canonical coverage but do not count as meaningful editorial activity.

The product tracks separately:

- `canonicalCoveragePercent`
- meaningful edit count/duration
- events per minute
- Keep Pastor duration
- no-change duration
- graphics, B-roll, Scripture, reframes, and captions

## Editorial Quality QA

Existing engineering QA remains unchanged:

- video;
- audio;
- Director coverage;
- rights;
- placement;
- Bengali graphics;
- review readiness.

V1.3.1 adds **Editorial Quality**, covering:

- source/output format integrity;
- destructive fit detection;
- meaningful activity;
- context-aware static stretches;
- approved-plan realization;
- B-roll realization;
- repetitive visual categories;
- missing/placeholder text;
- planned opening/closing treatments.

Eligible static intervals are calculated after subtracting meaningful event intervals. A brief one-second edit does not hide a remaining long static stretch. Reverent-only prayer is not failed solely for low density.

## Plan realization

Diagnostics list:

- approved operations;
- renderer-mapped operations;
- dropped operations;
- unsupported operations.

Every approved operation must map explicitly. Unresolved placeholders and invalid B-roll block rendering. A structured realization artifact is written during review planning, and the final Editorial Quality record includes realization diagnostics.

## Product UI

Before render, the project screen shows source dimensions/orientation and selected output dimensions/orientation. The Review Workspace shows:

- AI coverage;
- meaningful edits;
- Keep Pastor duration;
- no-change duration;
- graphics;
- B-roll;
- Scripture;
- reframes;
- captions.

After render, the project screen shows Editorial Quality separately from technical completion.

## Office validation

The deterministic 60-second benchmark represents a portrait Short with introduction, main point, question, teaching, story, and prayer sections. It contains no real media.

Office tests cover portrait/landscape selection, rotated metadata, unknown-format blocking, safe fitting, B-roll preservation and blocking, rights-safe replacement, Keep Pastor semantics, coverage/activity separation, functional-state isolation, full supported-operation mapping, dropped-operation detection, barren-timeline failure, reverent-prayer exemption, review summary, and creative trace.

No Ollama, Whisper, YouTube download, or full render is required.

## Personal-Mac validation still required

Use `docs/PERSONAL-MAC-V1-3-1-EDITORIAL-VALIDATION.md` to rerender the same audited Short and compare old versus new output. That visual comparison remains the release gate for editorial quality.
