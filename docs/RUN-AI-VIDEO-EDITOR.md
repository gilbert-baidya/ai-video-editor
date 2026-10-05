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

The host detects existing local tools. For transcription, place a validated multilingual Whisper model in the ignored local `models/` directory and set `WHISPER_MODEL=models/<model-file>` before starting. `WHISPER_LANGUAGE` defaults to `auto` to preserve Bengali/English code-switching; `bn` and `en` are also supported. English-only Whisper models are rejected for `auto` or Bengali transcription.

If a Whisper GPU/Metal allocation error occurs, the same job is retried once with GPU use disabled. Other transcription errors remain visible and are not retried as successful work. A transcript containing generic foreign-language placeholders or suspicious output is rejected before Gemini analysis or caption generation.

Do not point the production configuration at an archived project or another repository's model directory. The application does not download or duplicate model files automatically.

Do not place source media in committed folders. Runtime projects are stored under ignored `.runtime/projects/`.

For bounded real validation, follow `docs/PERSONAL-MAC-V1-3-VALIDATION.md`.

## Troubleshooting

- **Port already in use:** stop only the previously started AI Video Editor host process, or choose a free port with `PRODUCT_PORT=<port> npm run dev:product`.
- **Provider unavailable:** confirm the already-installed personal-Mac provider is running and inspect the Capabilities panel. Do not treat an unavailable state as success.
- **Transcription not configured:** confirm FFmpeg, `whisper-cli`, and `WHISPER_MODEL` are all available.
- **YouTube unavailable:** use a local video or validate later on a Mac with an already-configured `yt-dlp`.
- **Interrupted job after restart:** retry that stage. Completed upstream artifacts remain reusable.
