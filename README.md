<div align="center">

**English** · [简体中文](README.zh-CN.md)

[HRouter](https://hrouter.net/home) · [All public projects](https://github.com/honestTai) · [Star & Fork trends](#project-activity)

</div>

[![Repository summary](https://raw.githubusercontent.com/honestTai/honestTai/main/assets/badges/seehtml-ai.svg)](#project-activity)

# SeeHTML AI

**From an idea to HTML, presentations, and video.**

SeeHTML AI is a local desktop workspace for HTML creation, preview, and export. It brings Agent-assisted HTML generation, live preview, PPTX export, and MP4 rendering into one project-based workflow.

It is not a template editor. It is closer to a local coding agent for visual HTML work: open a project, describe what you want, generate or edit HTML, preview it, and export the result.

### Windows Download

Installer version verified on September 13, 2026: [`SeeHTML AI v2.0.0`](https://github.com/honestTai/seehtml-ai/releases/tag/v2.0.0)

- Recommended installer: [`SeeHTML.AI_2.0.0_x64-setup.exe`](https://github.com/honestTai/seehtml-ai/releases/download/v2.0.0/SeeHTML.AI_2.0.0_x64-setup.exe)
- MSI installer: [`SeeHTML.AI_2.0.0_x64_en-US.msi`](https://github.com/honestTai/seehtml-ai/releases/download/v2.0.0/SeeHTML.AI_2.0.0_x64_en-US.msi)
- Open-source repository: [`honestTai/seehtml-ai`](https://github.com/honestTai/seehtml-ai)

The Windows installers include the desktop app and bundled FFmpeg resources for video export. On first launch, configure your own OpenAI-compatible model provider in Model Settings.

### Why

HTML is a strong medium for visual storytelling:

- It can describe layout, motion, typography, particles, story, and scenes in one file.
- It can be previewed instantly.
- It can be rendered frame-by-frame into MP4.
- It can also become PowerPoint material.

SeeHTML AI wraps this into a desktop workspace: project tree on the left, preview/export in the center, and an Agent conversation on the right.

### Features

- Generate or edit complete HTML documents with an Agent.
- Preview HTML, MP4, PDF, Markdown, PNG, and common project files.
- Export HTML pages to PowerPoint, one HTML page per slide.
- Render animated HTML to MP4 with bundled FFmpeg.
- Capture the current page as PNG.
- Use local OCR fallback when the configured model does not support image understanding.
- Store project-scoped memory and context index in `.seehtml/memory.sqlite3`.
- Keep model providers configurable instead of hard-coding a single vendor.

### Agent Orchestration

The Agent panel is not a single prompt wrapper. It is a local orchestration loop designed around producing usable HTML artifacts. A request such as "make a 45-second cyberpunk short-video animation from this reference image" is decomposed into a practical workflow:

1. Request understanding: parse the user prompt, current project, uploaded images, target format, and duration requirements.
2. Visual understanding: use vision-capable models when available; otherwise fall back to local OCR to extract text and structural hints from images.
3. Context retrieval: pull relevant snippets, project memory, and file context from the current workspace and `.seehtml/memory.sqlite3` instead of flooding the model with the entire history.
4. Task planning: decide whether to create new HTML, revise existing HTML, add export hooks, or enter a quality repair pass.
5. HTML generation: produce complete HTML/CSS/JS with layout, animation, asset strategy, and export support in one artifact when possible.
6. Preview checks: load the HTML in the center preview, then check viewport behavior, styling, responsiveness, animation playback, and asset references.
7. Repair pass: when layout overflow, broken assets, missing export hooks, or interrupted model output is detected, the Agent can continue and patch the artifact.
8. Export execution: render PNG, PowerPoint, or MP4; MP4 export uses deterministic frame rendering plus FFmpeg.

The goal is to keep coding, previewing, repairing, and exporting inside one desktop workflow. It works well for motion posters, promo clips, product demos, slide pages, course material, data reports, and visual HTML prototypes.

### Demo Direction

The included demo video shows one visual direction SeeHTML AI is good at:

- cyber-neon visuals
- retro-future pixel city
- particle trails and light streaks
- cinematic camera movement
- social-video pacing
- title card / brand end card
- HTML + Canvas animation exported as video

This is only a creative example, not a product limit. Agent skills are internal planning and quality-check guides. They do not restrict the user's request. You can still create product pages, slide decks, reports, course pages, minimal websites, dashboards, and other HTML outputs.

### Workflow

1. Open or create a local project.
2. Type a request in the Agent panel, optionally with reference images.
3. Let the Agent understand the request, retrieve context, and generate or modify HTML.
4. Preview the result.
5. Export when needed:
   - PNG screenshots
   - PowerPoint decks
   - MP4 videos
6. Continue iterating in the same project. Memory and context stay project-scoped.

### Model Configuration

SeeHTML AI uses OpenAI-compatible Chat Completions APIs.

Common provider styles include:

- OpenAI / GPT
- DeepSeek
- GLM / Zhipu
- OpenRouter
- 4router
- Ollama local models
- custom OpenAI-compatible gateways

Open Model Settings in the app and configure:

- provider
- API URL
- API key
- model name
- Authorization Bearer usage
- vision support
- default OCR fallback

No production API key is committed to this repository.

Environment variables are supported:

```bash
SEEHTML_AI_PROVIDER=custom
SEEHTML_AI_API_URL=https://api.example.com/v1/chat/completions
SEEHTML_AI_API_KEY=your_key
SEEHTML_AI_MODEL=your_model
SEEHTML_AI_USE_AUTH_HEADER=true
SEEHTML_AI_SUPPORTS_VISION=false
SEEHTML_AI_USE_DEFAULT_OCR=true
```

You can also point the app to a config file:

```bash
SEEHTML_AI_CONFIG=C:\path\to\ai-config.json
```

### Project Memory

Each project has its own SQLite memory database:

```text
your-project/
  .seehtml/
    memory.sqlite3
```

It stores:

- compact conversation memory
- relevant project context snippets
- file context index data

For each Agent turn, only relevant snippets are retrieved so long projects do not flood the model context.

### Animated MP4 Export

For reliable MP4 export, generated HTML should expose a deterministic frame-rendering API:

```js
const DURATION = 30;
window.__SEEHTML_EXPORT_DURATION__ = DURATION;

function renderAtTime(seconds) {
  // Render the full frame from absolute time.
}

window.renderAtTime = renderAtTime;

window.addEventListener("seehtml:export-frame", (event) => {
  renderAtTime(event.detail.time);
});
```

This lets SeeHTML AI render animated HTML frame-by-frame instead of relying only on real-time playback.

### Development

Requirements:

- Node.js
- Rust
- Windows desktop packaging environment

Install:

```bash
npm install
```

Run in development:

```bash
npm run dev
```

Build frontend:

```bash
npm run build
```

Build Windows installers:

```bash
npm run build:full
```

The build script prepares local OCR and FFmpeg dependencies, then packages the Tauri app.

Installer output:

```text
target/release/bundle/nsis/
target/release/bundle/msi/
```

The current release was built on Windows with:

```bash
npm run build:full
```

Generated v2.0.0 artifacts:

- `target/release/bundle/nsis/SeeHTML AI_2.0.0_x64-setup.exe`
- `target/release/bundle/msi/SeeHTML AI_2.0.0_x64_en-US.msi`

### Repository Notes

The following files and folders are not committed:

- `node_modules/`
- `dist/`
- `target/`
- `ffmpeg/`
- `python/`
- `*.exe`
- `*.msi`
- signing certificates and keys

### License

MIT License.

Maintained by honestTai. Configure your model provider in the app, or explore my HRouter model-access service.

---

<a id="project-activity"></a>

## Project activity

Star / Fork totals and retained-event history, scheduled to refresh daily.

[![Star and Fork history for seehtml-ai](https://raw.githubusercontent.com/honestTai/honestTai/main/assets/metrics/seehtml-ai.svg)](https://github.com/honestTai/honestTai/blob/main/data/README.md)

[Observed daily totals](https://raw.githubusercontent.com/honestTai/honestTai/main/assets/metrics/seehtml-ai-daily.svg) · [Methodology](https://github.com/honestTai/honestTai/blob/main/data/METHODOLOGY.md) · [All public projects](https://github.com/honestTai)

<sub>Historical curves reconstruct currently retained stars and visible forks, not historical net totals. Separate daily observations start on 2026-10-06; no fabricated backfill.</sub>
