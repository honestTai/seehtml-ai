<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/hero.svg">
  <img src="docs/assets/hero-light.svg" alt="SeeHTML AI">
</picture>

**SeeHTML AI is a local desktop workspace for HTML creation, preview, and export.**

[HRouter](https://hrouter.net/home) · [Demo](docs/assets/seehtml-motion-promo.mp4) · [Issues](https://github.com/honestTai/seehtml-ai/issues)

**English** · [简体中文](README.zh-CN.md)

</div>

## ❤️ Sponsor

| Sponsor | What it is |
| :--- | :--- |
| [![HRouter](docs/assets/hrouter-sponsor.svg)](https://hrouter.net/home) | **[HRouter](https://hrouter.net/home)**: model access, API key management, and usage tracking for AI coding and application development. Also operated by the maintainer. |

## Quick start

Installer version verified on September 13, 2026: [`SeeHTML AI v2.0.0`](https://github.com/honestTai/seehtml-ai/releases/tag/v2.0.0)

- Recommended installer: [`SeeHTML.AI_2.0.0_x64-setup.exe`](https://github.com/honestTai/seehtml-ai/releases/download/v2.0.0/SeeHTML.AI_2.0.0_x64-setup.exe)
- MSI installer: [`SeeHTML.AI_2.0.0_x64_en-US.msi`](https://github.com/honestTai/seehtml-ai/releases/download/v2.0.0/SeeHTML.AI_2.0.0_x64_en-US.msi)

The Windows installers include the desktop app and bundled FFmpeg resources for video export. On first launch, configure your own OpenAI-compatible model provider in Model Settings.

Requirements: Node.js, Rust, and a Windows desktop packaging environment.

```bash
npm install
npm run dev
npm run build
npm run build:full
```

`npm run dev` runs the app locally. `npm run build` builds the frontend. `npm run build:full` prepares local OCR and FFmpeg dependencies, then packages the Tauri app. Installer output:

```text
target/release/bundle/nsis/
target/release/bundle/msi/
```

## Core features

| Feature | What it does |
| --- | --- |
| Agent | Generate or edit complete HTML documents |
| Preview | HTML, MP4, PDF, Markdown, PNG, and common project files |
| PowerPoint | Export HTML pages, one HTML page per slide |
| MP4 | Render animated HTML with bundled FFmpeg |
| PNG | Capture the current page |
| OCR | Local OCR fallback when the configured model does not support image understanding |
| Memory | Project-scoped memory and context index in `.seehtml/memory.sqlite3` |
| Providers | Configurable OpenAI-compatible model providers |

## Docs

- [Demo video](docs/assets/seehtml-motion-promo.mp4)
- [Motion cover](docs/assets/seehtml-motion-cover.jpg)
- [Motion preview](docs/assets/seehtml-motion-preview.gif)

## License

[MIT License](LICENSE).

Maintained by honestTai. Configure your model provider in the app, or explore my HRouter model-access service.

## Star history

<a href="https://www.star-history.com/#honestTai/seehtml-ai&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=honestTai/seehtml-ai&type=Date&theme=dark">
    <img src="https://api.star-history.com/svg?repos=honestTai/seehtml-ai&type=Date" alt="Star history of seehtml-ai">
  </picture>
</a>

---

<div align="center">

Made by **[honestTai](https://github.com/honestTai)** · [HRouter](https://hrouter.net/home) · [More projects](https://github.com/honestTai)

</div>
