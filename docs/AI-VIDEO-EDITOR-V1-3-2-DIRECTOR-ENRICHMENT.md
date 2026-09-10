# AI Video Editor V1.3.2 — Director Editorial Enrichment

**IMPLEMENTATION: COMPLETE**

**OFFICE TESTS: PASS**

**REAL VIDEO DIRECTOR VALIDATION: PERSONAL-MAC-PENDING**

V1.3.2 does not declare the real Short editorially ready. The same media must be analyzed and rerendered with the live personal-Mac AI stack.

## Why V1.3.1 still failed editorially

V1.3.1 correctly preserved portrait framing, prevented silent operation loss, separated functional review state, and added Editorial Quality QA. The same Short nevertheless produced:

- 100% canonical coverage;
- no fallback;
- one meaningful edit;
- approximately 58 seconds of no-change;
- no B-roll, Scripture, or reframes;
- a long eligible static stretch.

The QA system correctly reported the problem. The remaining failure was upstream: the Director plan was too conservative.

## Director over-conservatism

The previous prompt protected reverent content but did not give enough section-specific guidance for ordinary teaching, rhetorical questions, main points, stories, illustrations, and emphasis. `speaker-full` remained the easiest valid response.

The V1.3.2 prompt explicitly states:

- Reverent Retention is not visual inactivity.
- No Change is deliberate, not a safety default.
- Main points should consider concise sermon points, captions, punch-ins, or reframes.
- Questions should consider an emphasis caption, punch-in, or reframe.
- Teaching may use occasional semantic captions or restrained reframes.
- Stories/illustrations should actively consider contextual B-roll, then speaker-led alternatives.
- Strong emphasis may use a key phrase, punch-in, or visual reset.
- Constant cuts and unrelated visuals remain prohibited.

The prompt schema version is bumped so old cached responses cannot masquerade as V1.3.2 output.

## Editorial Opportunity model

`EditorialOpportunity` is deterministic guidance, not a deterministic editor. Each section receives:

- section identity;
- semantic type;
- intensity;
- reverence sensitivity;
- LOW, MEDIUM, or HIGH visual opportunity;
- allowed visual palette;
- current recommendation;
- reason.

Examples:

| Section | Opportunity | Guidance |
| --- | --- | --- |
| Prayer/altar-call/emotional ministry | LOW, protected | Calm speaker-led treatment |
| Scripture reading | MEDIUM, protected | Existing verified Scripture contract or calm speaker |
| Normal teaching/application | MEDIUM | Caption, subtle reframe, occasional punch-in |
| Main point/question/emphasis | HIGH | Concise graphic/caption or restrained reframe |
| Story/illustration/testimony | HIGH | Contextual B-roll or meaningful speaker-led alternative |

The model identifies where enrichment is appropriate. It never selects an operation itself.

## Pre-review Director quality

After chunk reconciliation, the application evaluates the initial AI decisions before Review Workspace creation.

The persisted `DirectorQualitySummary` includes:

- total and eligible sections;
- meaningful recommendations;
- no-change and speaker-full counts;
- B-roll and caption recommendations;
- reframes, graphics, and Scripture;
- untreated story sections;
- visual variety score;
- static risk;
- longest eligible untreated duration;
- enrichment trigger and attempt count;
- NORMAL, LOW-ACTIVITY, or ENRICHED status.

Canonical coverage remains separate. A plan can have 100% coverage and LOW-ACTIVITY Director quality.

## Bounded AI enrichment

```text
Initial Director
  -> Editorial Opportunity analysis
  -> Director Quality evaluation
  -> NORMAL: keep initial plan
  -> LOW-ACTIVITY: one provider enrichment request
  -> validate canonical identity/timing and opportunity palette
  -> reevaluate quality
  -> stop
```

The default maximum is one provider generation attempt. The Ollama adapter disables its normal retry behavior for this phase, and provider responses that report more than one attempt are rejected. There is no loop.

If the provider is absent, unavailable, failed, or does not implement enrichment:

- no deterministic edits are invented;
- the original analysis remains unchanged;
- diagnostics record that enrichment was required but unavailable.

Successful enrichment participates in the existing stage cache. Resume/retry reuses it and does not repeat the provider request.

Persisted enrichment outcome is explicit:

- `not-needed`
- `succeeded`
- `failed`
- `unavailable`

Provider, model, actual attempt count, error, and cache reuse are retained. A failed attempt is never labeled as successfully used.

## Enrichment protections

The enrichment request must:

- revise only requested weak canonical segments;
- cover each requested segment exactly once;
- preserve canonical IDs and timing;
- preserve canonical section boundaries, semantic type, intensity, ordering, and transcript text;
- stay within the allowed visual palette;
- preserve meaning;
- leave prayer, Scripture reading, altar-call, and emotional-ministry sections untouched;
- avoid fabricated Scripture;
- avoid unrelated B-roll;
- avoid repetitive or meaningless cuts;
- keep captions concise and canonical.

Enrichment is rejected if it changes protected segments, duplicates/omits canonical identity, changes timing, uses a visual outside the opportunity palette, or returns transcript-sized captions.

## Reverent Retention

Prayer-only plans do not trigger activity-driven enrichment. Protected sections remain excluded even when neighboring teaching/story content is enriched.

Speaker and graphic cooldowns are now tracked independently. A caption or sermon-point graphic no longer incorrectly resets the speaker-reframe cooldown and suppresses a later restrained teaching reframe.

## Story and B-roll

Story/illustration sections explicitly consider B-roll. The enrichment pass may recommend B-roll but cannot fabricate an asset.

The V1.3.1 contract remains:

- recommendation becomes an unresolved placeholder;
- Review Workspace resolves an approved rights-safe asset;
- otherwise the human chooses Keep Pastor, reject, reframe, punch-in, or a concise available caption;
- no fake media reaches the approved plan.

## Captions and sermon points

Captions must be short semantic phrases grounded in the canonical transcript. Full transcript sections, text over 120 characters, more than two lines, placeholders, and missing text fail validation/Editorial QA.

Main-point graphics remain selective, concise treatments rather than automatic cards for every sentence.

## Scripture

The existing chain remains authoritative:

```text
Detected Reference
  -> Verification
  -> Approved Verse Text
  -> Render
```

Enrichment does not modify protected Scripture-reading sections or invent Bengali verse text.

## Review Workspace

The workspace now displays:

- canonical coverage;
- editorial activity;
- Director quality status;
- meaningful edits;
- no-change and Keep Pastor duration;
- untreated story count;
- visual categories;
- enrichment used, not needed, or required/unavailable.

LOW-ACTIVITY status is surfaced as a warning rather than hidden behind 100% coverage.

## Editorial Quality QA

The V1.3.1 gate is unchanged and pinned as `editorial-quality-v1.3.1`. The Director must produce a stronger plan; QA thresholds were not weakened.

The deterministic portrait benchmark proves:

- its deliberately barren plan still fails;
- one bounded enrichment pass increases meaningful activity and visual variety;
- story receives a B-roll opportunity without a fake asset;
- normal teaching receives restrained variation;
- prayer remains calm;
- the resolved enriched approved plan has zero dropped/unsupported operations;
- the enriched plan passes the same Editorial Quality evaluator.

## Office validation

The office suite uses an explicit mock AI provider. It does not run Ollama or fake a live result.

It validates:

- prayer-only skip;
- mixed-content trigger;
- one-attempt maximum;
- enrichment cache reuse;
- canonical identity/timing;
- prayer/Scripture protection;
- allowed visual palette;
- story/B-roll behavior;
- punch-in, reframe, caption, sermon point, and no-change lineage;
- variety diagnostics;
- barren failure and enriched pass;
- unchanged Editorial Quality QA.

## Personal-Mac validation pending

Follow `PERSONAL-MAC-V1-3-2-DIRECTOR-VALIDATION.md` using the same Short and the real Ollama/Qwen/Whisper stack. Compare V1.3, V1.3.1, and V1.3.2 outputs before declaring editorial GO.
