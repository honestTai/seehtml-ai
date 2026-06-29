---
name: image-ocr
description: Use when the user asks to read, inspect, identify, OCR, or extract text from any image, screenshot, clipboard image, local image path, or "[Image #1]"; includes prompts like "识别一下", "识图", "识别图片", "读图", "看图", "截图里的文字", "图片里的文字", "OCR this image", or "extract text from image". The skill routes native vision first, then local OCR fallback.
---

# image-ocr

Read text and basic image characteristics locally as a fallback when native multimodal input is unavailable or returns `Unsupported Image`. Detect the current operating system before choosing the wrapper command.

Routing rule:

- If the active model can inspect the image natively and native reading succeeds, answer from native vision and do not run this wrapper.
- If native image reading is unavailable, the session only exposes a local image path, or native reading fails with `Unsupported Image`, run this wrapper automatically when an attachment/path is available.
- If the user explicitly asks for local OCR, deterministic text extraction, or a local/no-API workflow, run this wrapper even if native vision exists.
- Do not manually copy, resize, convert, or inspect image files with generic shell/PIL/ImageMagick workflows before applying this routing rule. This skill owns image-read fallback decisions.

## Core Workflow

1. Resolve the image path from the user's message, attachment metadata, clipboard image metadata, or local temp-file path. For Claude Code attachments shown as `[Image #1]`, use the attached file path if available. Expand `~` and use an absolute path.
2. Run the bundled wrapper for the current operating system:

   macOS/Linux:

   ```bash
   /bin/sh "$HOME/.claude/skills/image-ocr/image-ocr" /absolute/path/to/image.png
   ```

   Windows PowerShell:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.claude\skills\image-ocr\image-ocr.ps1" "C:\absolute\path\to\image.png"
   ```

   If the wrapper is also installed on PATH, this equivalent command is fine:

   ```bash
   image-ocr /absolute/path/to/image.png
   ```

   Do not probe availability with `where tesseract`, `where image-ocr`, or `command -v image-ocr` before using the skill. PATH can be stale inside long-running agent sessions. Run the absolute wrapper path or `image-ocr --doctor` for dependency status.

3. For Chinese and English OCR, keep the default language list. For specific language mixes:

   ```bash
   image-ocr /absolute/path/to/image.png --lang zh-Hans,en-US
   ```

4. Use the script output as evidence. Summarize recognized text first when the user asks to read or identify the image. Mention low confidence, empty OCR, or engine warnings when relevant. If native image reading failed with `Unsupported Image`, do not stop there; run this wrapper when an attachment path is available.

## Dependency Handling

If the command says Python is missing, do not attempt OCR. Tell the user to install Python 3 first:

- macOS: install from `https://www.python.org/downloads/` or run `xcode-select --install`.
- Windows: install from `https://www.python.org/downloads/windows/` and enable "Add python.exe to PATH".
- Linux: install `python3` with the distro package manager.

If the command says no OCR engine is available, tell the user:

- macOS: install Xcode Command Line Tools with `xcode-select --install` for Apple Vision OCR.
- Windows: install Tesseract, ensure `tesseract.exe` is on PATH, then restart the terminal. Chinese OCR needs `chi_sim` or `chi_tra` traineddata.
- Linux: install Tesseract with the distro package manager and add language data packages as needed.

Use `image-ocr --doctor` to show local dependency status.

If the user wants dependencies installed automatically, or explicitly accepts installation, run:

```bash
image-ocr --install-deps --doctor
```

Use `--dry-run` first when you need to show the exact package-manager commands without changing the target computer.

## Quality Guidance

- Prefer the default `accurate` mode for screenshots, documents, UI, Chinese, and mixed-language images.
- Use `--level fast` only when speed matters more than accuracy.
- Keep the default `--vision-passes single` for Chinese or mixed Chinese/English screenshots. Use `--vision-passes best` only when the language is unknown and the single pass misses text.
- Use `--engine vision` on macOS when Apple Vision is available. Use `--engine tesseract` on Windows/Linux, or to force the fallback engine on macOS.
- When output is poor, rerun with a narrower language list such as `--lang zh-Hans` or `--lang en-US`.
- Treat OCR as text extraction, not full visual understanding. For object identity, charts, handwriting, or fine visual layout, state the limitation if no native vision model is available.
- Do not invent visual details beyond the script output.

## Manual Command

Claude Code also exposes a manual slash command:

```text
/image-ocr /absolute/path/to/image.png
```

Use the command when the user explicitly asks to run OCR or when automatic skill activation does not happen.
