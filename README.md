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
npx @tauri-apps/cli build
```

The Windows installers are generated under:

- `target/release/bundle/nsis/`
- `target/release/bundle/msi/`

Large local runtimes such as `python/`, `ffmpeg/`, build output, installers, and signing keys are intentionally ignored by Git.
