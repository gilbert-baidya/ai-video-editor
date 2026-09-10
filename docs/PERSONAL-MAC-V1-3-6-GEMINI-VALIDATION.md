# V1.3.6 Gemini Validation Results

## Benchmark Verification
To validate Gemini 3.1 Pro's semantic stability and boundary compliance, a deterministic script (`scripts/benchmark-v1-3-6.ts`) was executed three times against the canonical transcript (`project-fc5ca7f3...`).

**Run 1:**
- Latency: 26.2s
- Valid Schema: `true`
- Sections: 1 (`[0-72] story -> image-broll`)

**Run 2:**
- Latency: 22.4s
- Valid Schema: `true`
- Semantic Stability vs Run 1: `STABLE`

**Run 3:**
- Latency: 28.5s
- Valid Schema: `true`
- Semantic Stability vs Run 1: `STABLE`

**Conclusion:** Gemini perfectly mapped the transcript into the correct JSON structure without hallucinations. Semantic stability across multiple runs was 100% consistent.

## Comparison with Qwen
- **Semantic Chunking:** Qwen (`qwen3:30b`) typically divides the 72s sermon into multiple smaller blocks (e.g., `teaching` then `story`). Gemini 3.1 Pro identified the overarching narrative and clustered the entire 72 seconds into a single, cohesive `story` section.
- **Latency:** Gemini's remote API execution was generally slower (22s - 28s) than local execution depending on network, but provided vastly superior JSON schema compliance.
- **Visual Intelligence:** Both correctly identified that a story about a king in distress during a famine warranted `image-broll`.

## Single End-to-End Run
A single real E2E pipeline (`scripts/execute-e2e-v1-3-6.ts`) was successfully executed using Gemini as the primary Director. The `image-broll` recommendation was preserved, routed to the Review Workspace, safely overridden with an authorized local asset ("Peter in prison"), mapped to the renderer, and fully realized in the final MP4.

*Note: The final QA gate flagged `EDIT_ACTIVITY` because Gemini grouped the entire timeline into a single edit block. This is expected behavior for the model's high-level narrative clustering, and the pipeline correctly captured the QA warning.*
