<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/hero.zh-CN.svg">
  <img src="docs/assets/hero.zh-CN-light.svg" alt="SeeHTML AI">
</picture>

**SeeHTML AI 是一个本地桌面端 HTML 创作与导出工作台。**

[HRouter](https://hrouter.net/home) · [演示视频](docs/assets/seehtml-motion-promo.mp4) · [使用反馈](https://github.com/honestTai/seehtml-ai/issues)

[English](README.md) · **简体中文**

</div>

## 快速开始

本页安装包对应版本（2026-09-13 核验）：[`SeeHTML AI v2.0.0`](https://github.com/honestTai/seehtml-ai/releases/tag/v2.0.0)

- 推荐安装包：[`SeeHTML.AI_2.0.0_x64-setup.exe`](https://github.com/honestTai/seehtml-ai/releases/download/v2.0.0/SeeHTML.AI_2.0.0_x64-setup.exe)
- MSI 安装包：[`SeeHTML.AI_2.0.0_x64_en-US.msi`](https://github.com/honestTai/seehtml-ai/releases/download/v2.0.0/SeeHTML.AI_2.0.0_x64_en-US.msi)

Windows 安装包已包含桌面应用和用于视频导出的 FFmpeg 资源。首次使用时，请在应用内“模型设置”里配置自己的 OpenAI-compatible 模型服务。

依赖：Node.js、Rust、Windows 桌面端打包环境。

```bash
npm install
npm run dev
npm run build
npm run build:full
```

`npm run dev` 用于本地开发运行，`npm run build` 构建前端。`npm run build:full` 会准备本地 OCR 和 FFmpeg 依赖，然后执行 Tauri 打包。安装包输出目录：

```text
target/release/bundle/nsis/
target/release/bundle/msi/
```

## 主要能力

| 能力 | 说明 |
| --- | --- |
| Agent | 用 Agent 生成或修改完整 HTML 文档 |
| 预览 | HTML、MP4、PDF、Markdown、PNG 和常见项目文件 |
| PowerPoint | 将 HTML 页面导出为 PowerPoint，一页 HTML 对应一页幻灯片 |
| MP4 | 将带动画的 HTML 通过 FFmpeg 导出为 MP4 |
| PNG | 捕获当前页面为 PNG |
| OCR | 当配置模型不支持图片理解时，使用本地 OCR 回退 |
| 记忆 | 每个项目使用 `.seehtml/memory.sqlite3` 保存记忆和上下文索引 |
| 模型 | 模型供应商可配置，接入 OpenAI-compatible 服务 |

## 文档

- [演示视频](docs/assets/seehtml-motion-promo.mp4)
- [封面](docs/assets/seehtml-motion-cover.jpg)
- [预览动图](docs/assets/seehtml-motion-preview.gif)

## 开源协议

[MIT License](LICENSE)。

由 [honestTai](https://github.com/honestTai) 维护。模型供应商可在应用内配置；也欢迎了解我运营的 [HRouter](https://hrouter.net/home) 模型接入服务。

## 星标历史

<a href="https://www.star-history.com/#honestTai/seehtml-ai&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=honestTai/seehtml-ai&type=Date&theme=dark">
    <img src="https://api.star-history.com/svg?repos=honestTai/seehtml-ai&type=Date" alt="seehtml-ai 的 Star 历史">
  </picture>
</a>

---

<div align="center">

Made by **[honestTai](https://github.com/honestTai)** · [HRouter](https://hrouter.net/home) · [More projects](https://github.com/honestTai)

</div>
