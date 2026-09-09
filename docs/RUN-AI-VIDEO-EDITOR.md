# Run AI Video Editor

## Office Mac

No Ollama, Whisper, downloader, Docker, Homebrew package, Python environment, external application, or system service is required to launch the product.

From the AI Video Editor repository:

```bash
npm run dev:product
```

Open:

```text
http://127.0.0.1:4173
```

The Capabilities panel reports unavailable services without pretending that their stages succeeded. Local project creation/upload and office-safe tests remain usable.

Run the V1.3 office suite:

```bash
npm run test-product-orchestration-v1-3
```

## Personal Mac

Use the same command:

```bash
npm run dev:product
```

The host detects existing local tools. For transcription, set `WHISPER_MODEL` to a model path relative to the repository root before starting. The existing Director provider uses `OLLAMA_HOST` and `SERMON_DIRECTOR_MODEL` when supplied; its defaults remain `http://127.0.0.1:11434` and `qwen3:30b`.

Do not place source media in committed folders. Runtime projects are stored under ignored `.runtime/projects/`.

For bounded real validation, follow `docs/PERSONAL-MAC-V1-3-VALIDATION.md`.

## Troubleshooting

- **Port already in use:** stop only the previously started AI Video Editor host process, or choose a free port with `PRODUCT_PORT=<port> npm run dev:product`.
- **Provider unavailable:** confirm the already-installed personal-Mac provider is running and inspect the Capabilities panel. Do not treat an unavailable state as success.
- **Transcription not configured:** confirm FFmpeg, `whisper-cli`, and `WHISPER_MODEL` are all available.
- **YouTube unavailable:** use a local video or validate later on a Mac with an already-configured `yt-dlp`.
- **Interrupted job after restart:** retry that stage. Completed upstream artifacts remain reusable.
