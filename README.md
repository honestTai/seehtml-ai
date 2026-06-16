# SeeHTML AI

SeeHTML AI is a Tauri + React desktop app for previewing HTML, video, PDF, Markdown, and image files with an Agent panel for generating, editing, and exporting HTML content.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run build:full
```

The Windows installers are generated under:

- `target/release/bundle/nsis/`
- `target/release/bundle/msi/`

MP4 export is encoded with bundled FFmpeg. `npm run build:full` downloads the local Python OCR runtime and FFmpeg before packaging, while the runtime folders themselves stay out of Git.

Large local runtimes such as `python/`, `ffmpeg/`, build output, installers, and signing keys are intentionally ignored by Git.
