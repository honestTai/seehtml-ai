# SeeHTML AI

[中文](#中文) | [English](#english)

[GitHub](https://github.com/honestTai/seehtml-ai) · [Windows Release v2.0.0](https://github.com/honestTai/seehtml-ai/releases/tag/v2.0.0)

![SeeHTML Motion cover](docs/assets/seehtml-motion-cover.jpg)

![SeeHTML Motion preview](docs/assets/seehtml-motion-preview.gif)

Demo video: [download / raw MP4](https://raw.githubusercontent.com/honestTai/seehtml-ai/open-source/docs/assets/seehtml-motion-promo.mp4)

---

## 中文

SeeHTML AI 是一个本地桌面端 HTML 创作与导出工作台。它把“用 Agent 生成 HTML、实时预览、导出 PPTX / MP4”整合到一个项目型工作流里。

它不是模板编辑器，更像一个面向 HTML 创作的本地 Agent：打开项目，输入需求，生成或修改 HTML，然后在同一个窗口里预览和导出。

### Windows 下载

最新版本：[`SeeHTML AI v2.0.0`](https://github.com/honestTai/seehtml-ai/releases/tag/v2.0.0)

- 推荐安装包：[`SeeHTML.AI_2.0.0_x64-setup.exe`](https://github.com/honestTai/seehtml-ai/releases/download/v2.0.0/SeeHTML.AI_2.0.0_x64-setup.exe)
- MSI 安装包：[`SeeHTML.AI_2.0.0_x64_en-US.msi`](https://github.com/honestTai/seehtml-ai/releases/download/v2.0.0/SeeHTML.AI_2.0.0_x64_en-US.msi)
- 开源仓库：[`honestTai/seehtml-ai`](https://github.com/honestTai/seehtml-ai)

Windows 安装包已包含桌面应用和用于视频导出的 FFmpeg 资源。首次使用时，请在应用内“模型设置”里配置自己的 OpenAI-compatible 模型服务。

### 为什么做它

HTML 很适合做视觉表达：

- 可以同时描述布局、动效、字体、粒子、剧情和场景。
- 可以在浏览器里即时预览。
- 可以逐帧渲染成 MP4。
- 也可以按页面导出成 PowerPoint。

SeeHTML AI 把这些能力做成桌面工作台：左侧项目文件树，中间预览与导出，右侧 Agent 会话。

### 主要能力

- 用 Agent 生成或修改完整 HTML 文档。
- 预览 HTML、MP4、PDF、Markdown、PNG 和常见项目文件。
- 将 HTML 页面导出为 PowerPoint，一页 HTML 对应一页幻灯片。
- 将带动画的 HTML 通过 FFmpeg 导出为 MP4。
- 捕获当前页面为 PNG。
- 当配置模型不支持图片理解时，自动使用本地 OCR 回退。
- 每个项目独立使用 `.seehtml/memory.sqlite3` 保存记忆和上下文索引。
- 模型供应商完全可配置，不把某一家服务商写死在开源代码里。

### Agent 编排流程

SeeHTML AI 的右侧 Agent 不是一次性 prompt，而是一条面向 HTML 产物的本地编排链路。用户只需要描述目标，比如“根据这张图做一个 45 秒赛博朋克短视频动画”，系统会把需求拆成可执行步骤：

1. 需求理解：解析用户文本、当前项目、上传图片、导出目标和时长要求。
2. 视觉理解：如果模型支持视觉输入，直接读取图片；如果不支持，则用本地 OCR 作为回退，提取画面里的文字和结构线索。
3. 上下文检索：从当前项目和 `.seehtml/memory.sqlite3` 中取出相关文件片段、历史偏好和项目记忆，避免把整段历史硬塞进模型。
4. 任务规划：决定是新建 HTML、修改现有 HTML、补动画导出接口，还是进入质量修复流程。
5. HTML 生成：产出完整 HTML/CSS/JS，尽量让动画、布局、素材策略和导出接口在一个文件里闭环。
6. 预览检查：在中间预览区加载 HTML，检查 viewport、样式、响应式布局、动画播放和资源引用。
7. 自动修复：当发现图片加载、布局溢出、导出接口、模型中断等问题时，Agent 会进入 repair pass，继续补全或重写关键片段。
8. 导出执行：根据用户选择导出 PNG、PPTX 或 MP4；MP4 通过确定性逐帧渲染和 FFmpeg 合成视频。

这个流程的目标是让“写代码、看效果、修问题、导出文件”尽量在一个窗口里完成。它适合做动态海报、宣传短片、产品演示、PPT 页面、课程内容、数据报告和各种可视化 HTML 原型。

### 宣传视频方向

仓库内置的 demo 视频展示了 SeeHTML AI 很适合的一类视觉方向：

- 赛博霓虹
- 像素未来城市
- 粒子轨迹和流光
- 镜头推进与短视频节奏
- 大标题/品牌卡收束
- HTML + Canvas 动画导出为视频

这只是一个创意示例，不是产品限制。Agent 的 Skill 只是后台思考和质量检查过程，不会限制用户需求。你依然可以生成产品页、PPT 汇报页、数据报告、课程页面、极简网页、仪表盘或其他任何 HTML。

### 基本工作流

1. 打开或创建一个本地项目。
2. 在 Agent 窗口输入需求，也可以附带参考图。
3. Agent 理解需求、检索上下文、生成或修改 HTML。
4. 在预览窗口查看效果。
5. 根据需要导出：
   - PNG 截图
   - PowerPoint
   - MP4 视频
6. 在同一个项目里继续迭代。记忆和上下文索引只属于当前项目。

### 模型配置

SeeHTML AI 使用 OpenAI-compatible Chat Completions API。

常见可接入类型包括：

- OpenAI / GPT
- DeepSeek
- GLM / 智谱
- OpenRouter
- 4router
- Ollama 本地模型
- 其他自定义 OpenAI-compatible 网关

在应用内打开“模型设置”，配置：

- Provider
- API URL
- API Key
- 模型名
- 是否使用 Authorization Bearer
- 模型是否支持视觉输入
- 是否启用默认 OCR 回退

仓库不会提交生产 API Key。

也支持环境变量：

```bash
SEEHTML_AI_PROVIDER=custom
SEEHTML_AI_API_URL=https://api.example.com/v1/chat/completions
SEEHTML_AI_API_KEY=your_key
SEEHTML_AI_MODEL=your_model
SEEHTML_AI_USE_AUTH_HEADER=true
SEEHTML_AI_SUPPORTS_VISION=false
SEEHTML_AI_USE_DEFAULT_OCR=true
```

也可以指定配置文件：

```bash
SEEHTML_AI_CONFIG=C:\path\to\ai-config.json
```

### 项目记忆

每个项目都有自己的 SQLite 记忆库：

```text
your-project/
  .seehtml/
    memory.sqlite3
```

里面会存：

- 精简会话记忆
- 项目上下文片段
- 文件上下文索引

每一轮 Agent 只检索相关片段，不会把整个项目或超长历史全部塞进模型上下文。

### 动画 MP4 导出

为了让动画导出更稳定，生成的 HTML 最好暴露确定性的逐帧渲染接口：

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

这样 SeeHTML AI 可以逐帧渲染 HTML 动画，而不是依赖真实播放时间。

### 开发

依赖：

- Node.js
- Rust
- Windows 桌面端打包环境

安装：

```bash
npm install
```

开发运行：

```bash
npm run dev
```

构建前端：

```bash
npm run build
```

构建 Windows 桌面安装包：

```bash
npm run build:full
```

打包脚本会准备本地 OCR 和 FFmpeg 依赖，然后执行 Tauri 打包。

安装包输出目录：

```text
target/release/bundle/nsis/
target/release/bundle/msi/
```

当前 release 使用以下命令在 Windows 上构建：

```bash
npm run build:full
```

生成的 v2.0.0 产物：

- `target/release/bundle/nsis/SeeHTML AI_2.0.0_x64-setup.exe`
- `target/release/bundle/msi/SeeHTML AI_2.0.0_x64_en-US.msi`

### 仓库说明

以下内容不会提交到 Git：

- `node_modules/`
- `dist/`
- `target/`
- `ffmpeg/`
- `python/`
- `*.exe`
- `*.msi`
- 签名证书和密钥

### 开源协议

MIT License。

---

## English

SeeHTML AI is a local desktop workspace for HTML creation, preview, and export. It brings Agent-assisted HTML generation, live preview, PPTX export, and MP4 rendering into one project-based workflow.

It is not a template editor. It is closer to a local coding agent for visual HTML work: open a project, describe what you want, generate or edit HTML, preview it, and export the result.

### Windows Download

Latest version: [`SeeHTML AI v2.0.0`](https://github.com/honestTai/seehtml-ai/releases/tag/v2.0.0)

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
