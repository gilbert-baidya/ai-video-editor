# Local Assets Manifest

This repository intentionally stores source code, configuration, tests, proof scripts, documentation, and lightweight metadata. Large media, generated renders, local runtime data, and model files remain local and are excluded from Git.

| Category | Purpose | In Git | Usual local location | Regenerable | Transfer requirement |
|---|---|---|---|---|---|
| Original sermon media | Source audio/video for Full Sermon Pilot ingestion and render proofs | No | `local-media-proof/` and project-specific local media folders | No, unless the original source is available elsewhere | Manually copy the source media to the new Mac and update the local proof path as needed |
| Approved B-roll proof media | Rights-approved local illustrative media used by the V4/V4.1 selection and review proofs | Lightweight metadata/source references may be present; media files are not | `local-media-proof/` and `public/full-sermon-selected-media/` | The approved asset must be reacquired or copied | Manually copy approved assets and preserve filenames/metadata used by the proof scripts |
| Generated preview and render media | Control/director previews, bounded previews, benchmark renders, and full-sermon outputs | No | `artifacts/` and video files under `public/` | Yes, from the checked-in scripts and local source inputs | Optional for browsing old proof results; regenerate for new proofs |
| Lightweight public proof assets | Small non-video assets used by the browser proof surface, such as approved B-roll images | Yes when not matched by an ignore rule | `public/` | Usually yes, if the original approved asset is available | Clone from Git; verify any rights-approved asset is still available |
| Ollama model and runtime | Local AI provider used by live AI and structured-output proofs | No | Ollama's local model store and local environment | Usually, by pulling the required model again | Install Ollama and pull the required model separately; do not copy credentials |
| Whisper or transcription models | Local transcription and alignment diagnostics where applicable | No | Local model directory or the connected SermonClip/local transcription environment | Usually, by downloading the pinned model again | Install the required runtime/model separately; do not commit model files |
| SermonClip transcript dependency | Canonical transcript and timing input for protected Bangla transcript and Director proofs | No, when sourced from local SermonClip runtime data | Local SermonClip project data, transcript exports, or explicitly configured fixture paths | Only if the same source media and transcription workflow are available | Copy the needed transcript data or reproduce it through the documented SermonClip workflow |
| Dependencies and caches | Installed JavaScript packages and build/render caches | No | `node_modules/`, `.cache/`, `cache/`, `tmp/`, and `temp/` | Yes | Run the dependency installation commands on the new Mac |

## Notes

- Do not place API keys, tokens, OAuth files, credentials, private keys, or `.env` files in this repository.
- Video extensions are globally ignored so sermon sources and generated previews cannot be staged accidentally; normal source, scripts, docs, config, and lightweight public files remain eligible for Git.
- Existing local files are intentionally preserved on the current Mac and are not deleted by this checkpoint.
