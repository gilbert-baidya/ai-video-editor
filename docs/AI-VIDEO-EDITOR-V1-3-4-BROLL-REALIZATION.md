# AI Video Editor V1.3.4: Real B-roll Realization

## The Problem
In V1.3.3, the system correctly enforced story treatment and decision consistency during the Director planning phase. However, a major capability gap remained: there was no mechanism to actually map a real, rights-safe visual asset to the B-roll placeholder (`director-placeholder`) and render it successfully in the final output. The placeholder would block the render or fall back to default values.

## The V1.3.4 Solution

V1.3.4 introduces the final link in the chain: deterministic local media ingestion, rights-safe validation, and renderer asset mapping.

### 1. Manual Local Asset Import
If the default library lacks an appropriate asset, users can now import a local file explicitly marked with `rightsConfirmed`. 
- **Endpoint Added:** `POST /api/projects/:id/assets`
- **Result:** Converts local images into tracked `MediaAsset` objects (with `assetId`, MIME typing, dimensions, and explicit `rightsStatus: 'approved'`) and pushes them to the `mediaIndex`.

### 2. Rights-Safe Asset Contract
The `MediaAsset` interface strongly dictates whether an asset can reach final render.
- `rightsStatus` must be explicitly `'approved'` or `'owned'`.
- `unknown` rights strictly block the B-roll from advancing past human review.

### 3. Review Workspace Resolution
When human reviewers process a `director-placeholder` (which represents the AI's B-roll recommendation), they can select an indexed local asset. The `type` converts from `director-placeholder` to a fully resolved `broll` operation, committing the chosen `assetId` to the approved plan.

### 4. Renderer Mapping & Realization
The orchestrator now explicitly passes the approved assets array into `createRendererPlan`. 
- **Public URL Mapping:** Indexed B-roll files are copied into the Remotion `public/` directory (renamed to their `assetId`) and mapped via a public URL relative path.
- **Visual Display:** Remotion natively renders the asset precisely along the B-roll interval (`start` to `end`) dictated by the plan.
- **Audio Preservation:** B-roll visuals strictly overlay the Pastor channel; sermon audio remains uninterrupted and unmodified.

### 5. Deterministic Diagnostics
`plan-realization.json` now includes detailed tracing for B-roll realization. If an asset is resolved and successfully mapped, `rendererMapped: true` and `rendered: true` are asserted, confirming that a rights-safe visual successfully made it into the bundle without being dropped or ignored.
