# AI Video Editor V1.3.6: Gemini Primary Director

## Architecture

The AI Video Editor has been upgraded to use the Google Gemini API (`gemini-3.1-pro-preview`) as the primary Director, replacing Ollama (`qwen3:30b`) as the default production model. Ollama remains as a local fallback when the Gemini API is unavailable.

### Two-Pass Director Model
The V1.3.5 architectural principle of separating semantic classification from visual decisions is fully preserved:
1. **Semantic Classification (Pass 1):** The LLM analyzes the transcript to classify segments logically (`teaching`, `story`, `main-point`).
2. **Visual Editorial Decision (Pass 2):** The LLM ingests the locked semantic structure to decide on visual treatments (`speaker-full`, `image-broll`, `caption`, etc.).

### Gemini Hallucination Fix
During testing, Gemini exhibited a strong tendency to confuse array indices with video timestamps (e.g. outputting `72` instead of index `8` because the video is 72 seconds long). This was resolved by renaming the JSON schema properties from `startSegment`/`endSegment` to `startIndex`/`endIndex` and enforcing strict boundary mapping between the `AISermonSection` internal format and the external JSON.

## Capabilities Check
The system now discovers AI capabilities dynamically:
- `geminiAvailable`: Checks if `GEMINI_API_KEY` is present.
- `ollamaAvailable`: Checks if the local Ollama daemon is running.
The frontend `ProductHostWorkspace` displays the primary connected provider.
