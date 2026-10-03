# Professional Editing Workspace

The product host now opens into an editing workspace built on the existing backend, Review contracts and Remotion renderer. Source: [src/editor/](../src/editor), host: [ProductHostWorkspace.tsx](../src/ProductHostWorkspace.tsx).

## Screens
| Navigation | What it shows | Backed by |
|---|---|---|
| Projects | Project cards with stage dots, source format, export QA | `GET /api/projects` |
| Import / New Project | Local video or YouTube project creation | existing create/upload endpoints |
| AI Director | Five-step pipeline, provenance, recommendations | project workflow stages + review workspace |
| Review & Edit | Preview, multi-track timeline, inspector, scenes/media | review workspace + saved Review |
| Media Library | Imported assets, rights, usage, import form | `GET …/asset`, `POST …/assets` |
| Render / Export | Truthful export status, QA gates, re-render | existing render/QA/re-render stages |
| Settings | Capabilities, project stage/job diagnostics | `GET /api/capabilities` |

## Truthfulness rules
- Timeline clips are the approved Edit Plan operations (Review decisions applied); nothing decorative. Tracks: B-roll, Captions & titles, Framing, Main video, Audio.
- The preview uses the same frame resolver as the renderer (`resolveFrameVisuals`), so full-frame B-roll, the hidden Pastor picture and the punch-in match the export. Sermon audio keeps playing under B-roll.
- A source shorter than the approved timeline is shown as "No source footage"; the mismatch is reported, never padded or bypassed.
- Pipeline progress is shown only while the backend reports a stage running. "Match B-roll" is derived from resolved B-roll decisions.
- Export status is `QA_PASSED` only when render and QA completed, the QA record exists and every gate passes. A file on disk never counts as success; a QA pass still requires human review.
- Editing actions (Approve, Keep Pastor, Reject B-roll, Replace media, Revert, Open in Review) call the existing Review actions and save through `PUT …/review`. Drag/trim editing is not offered because the backend has no such operation.

## Layout
- Panels are resizable: scene library, AI Director/Inspector panel and the preview/timeline divider are `role="separator"` handles (drag, arrow keys, Shift = larger steps, Home/End, double-click or Enter to reset). Sizes are browser-local preferences, re-clamped to the window, never project data.
- Defaults adapt to window size and video orientation: portrait gives side panels more width and the preview more height; landscape gives the stage the full centre width. The stage always keeps the source aspect ratio (no cropping).
- The navigation rail collapses to icons below 1500 px (toggle at the bottom); the scene library is hidden below 1100 px and the layout stacks below 900 px.
- The timeline fits the whole duration by default; − / + / Fit control zoom. Labelled ruler marks are never closer than ~76 px with finer ticks between.

## Running it
- `npm run dev:product` — real runtime (`.runtime/projects`).
- `npm run seed-editor-fixture` (creates portrait and landscape projects) then `npm run dev:product:fixture` — synthetic, clearly labelled fixture project (no AI, Whisper or render involved) for inspecting the interface. `PRODUCT_RUNTIME_ROOT` selects the runtime directory.
- Open http://127.0.0.1:4173.

## Tests
`npm run test-editing-workspace` (project loading, timeline positions, preview/timeline sync, selection, review navigation, empty/failed states, pipeline and export status accuracy).
