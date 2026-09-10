# Personal Mac V1.3.1 Editorial Validation

**REAL VIDEO RERENDER: PERSONAL-MAC-PENDING**

Use the same audited YouTube Short:

```text
https://youtube.com/shorts/lPN9AWaTuEc
```

Do not run this checklist automatically on the office Mac. Do not begin a full-sermon render.

## Goal

Compare:

```text
OLD V1.3 OUTPUT
vs
NEW V1.3.1 OUTPUT
```

The target is not merely a valid file. The approved Director decisions must visibly reach the final portrait video.

## 1. Source and format

1. Start with `npm run dev:product`.
2. Create a fresh editorial-validation project.
3. Ingest the same Short.
4. Confirm effective source dimensions account for rotation metadata.
5. Confirm the UI reports approximately:

```text
SOURCE
1080×1918
Portrait

OUTPUT
1080×1920
Portrait
```

Fail if the output profile is landscape or source orientation is unknown.

## 2. Subject framing

Inspect opening, middle, and closing frames.

- The portrait speaker must remain normally framed.
- No automatic landscape `cover` crop may remove the head, face, body, pulpit, or important source composition.
- Explicit punch-ins/reframes must be intentional and bounded.
- Small aspect-ratio differences may create padding rather than crop.

## 3. Director plan

Record:

- provider/model and pure-AI/fallback provenance;
- canonical coverage;
- every section recommendation;
- B-roll requests;
- graphics, Scripture, captions, and reframes;
- explicit no-change decisions.

Coverage must not be used as a proxy for meaningful edit activity.

## 4. Functional review isolation

Do not run persistence-action tests against this project.

If functional Review Workspace checks are needed, use a separate disposable fixture project whose review purpose is `functional-test`. Confirm the host rejects attempts to persist it as editorial state.

## 5. Editorial review

Review the real creative plan manually:

- Accept appropriate restrained operations.
- Approve/edit display text.
- Resolve Scripture references.
- Select only owned/approved, usable B-roll.
- Use **Keep Pastor — Static** intentionally where appropriate.
- Reject inappropriate operations explicitly.

Reload and restart the host. Confirm the editorial review, approved plan, realization audit, and operation trace reload unchanged.

## 6. Meaningful edit activity

Before rendering, inspect the Review Workspace summary:

- AI coverage;
- meaningful edit count;
- Keep Pastor duration;
- no-change duration;
- graphics;
- B-roll;
- Scripture;
- reframes;
- captions.

Compare these values with the old output. Investigate a barren plan even when coverage is 100%.

## 7. B-roll realization

For every approved B-roll:

1. Confirm the asset exists in the current media index.
2. Confirm rights are `owned` or `approved`.
3. Confirm it is technically usable.
4. Confirm the approved operation references that exact asset ID.
5. Confirm the final video visibly renders it at the approved interval.

No B-roll recommendation may disappear without an explicit reject or Keep Pastor decision.

## 8. Render-plan realization

Inspect:

```text
artifacts/plan-realization.json
artifacts/operation-trace.json
```

Require:

- dropped approved operations: `0`;
- unsupported approved operations: `0`;
- every approved operation has a renderer realization;
- every intentional Keep Pastor interval is explicit.

## 9. Editorial Quality QA

Confirm independent results for:

- format integrity;
- edit activity/static stretches;
- plan realization;
- B-roll realization;
- repetition;
- text quality;
- opening/closing polish.

Also confirm existing engineering QA for video, audio, coverage, rights, placement, Bengali graphics, and review readiness.

If Editorial Quality fails, confirm the rendered file remains available for diagnosis while the project does not become `COMPLETED`.

## 10. Human viewer judgment

Watch old and new outputs completely, then record:

- Which version better preserves portrait framing?
- Are the Director’s decisions visible?
- Does B-roll support rather than distract from the sermon?
- Are captions/graphics readable and faithful?
- Are prayer and sensitive moments appropriately calm?
- Are normal teaching/story stretches visually intentional rather than barren?
- Does the edit feel reverent rather than hyperactive?

## Acceptance

V1.3.1 editorial quality may be declared GO only when:

1. new output is 1080×1920 portrait;
2. source framing is preserved;
3. functional tests did not alter editorial review;
4. dropped/unsupported approved operations are zero;
5. engineering QA passes;
6. Editorial Quality QA passes;
7. human comparison finds the new output meaningfully improved.

Until then, status remains **PERSONAL-MAC-PENDING**.
