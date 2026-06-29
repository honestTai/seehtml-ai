#!/usr/bin/env python3
"""Portable local OCR entrypoint for the image-ocr Claude Code skill."""

from __future__ import annotations

import argparse
import json
import locale
import os
import platform
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
SWIFT_HELPER = SCRIPT_DIR / "macos_vision_ocr.swift"


INSTALL_HELP = """\
image-ocr needs Python 3 and a local OCR engine.

Install Python 3:
- macOS: install from https://www.python.org/downloads/ or run `xcode-select --install`
- Windows: install from https://www.python.org/downloads/windows/ and enable "Add python.exe to PATH"
- Linux: install `python3` with your distro package manager, for example `sudo apt install python3`

Install or enable an OCR engine:
- macOS best path: install Xcode Command Line Tools so `/usr/bin/swift` can use Apple Vision OCR:
  `xcode-select --install`
- Windows/Linux fallback: install Tesseract and make `tesseract` available on PATH.
  Chinese OCR also needs the `chi_sim` or `chi_tra` traineddata package.

This skill does not use network APIs or require an API key.

For opt-in automatic installation, run:
  image-ocr --install-deps --doctor
"""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract text and image characteristics from a local image."
    )
    parser.add_argument("image", nargs="?", help="Path to a local image file.")
    parser.add_argument(
        "--lang",
        "--languages",
        default="zh-Hans,en-US",
        help="Comma-separated languages. Vision examples: zh-Hans,en-US. Tesseract examples: chi_sim,eng.",
    )
    parser.add_argument(
        "--engine",
        choices=("auto", "vision", "tesseract"),
        default="auto",
        help="OCR engine. Default: auto.",
    )
    parser.add_argument(
        "--level",
        choices=("accurate", "fast"),
        default="accurate",
        help="macOS Vision recognition level. Default: accurate.",
    )
    parser.add_argument(
        "--vision-passes",
        choices=("best", "single"),
        default="single",
        help="For macOS Vision, single uses requested languages; best also tries automatic language detection. Default: single.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the raw JSON result instead of a plain-text report.",
    )
    parser.add_argument(
        "--doctor",
        action="store_true",
        help="Check local dependencies and print installation guidance.",
    )
    parser.add_argument(
        "--install-deps",
        action="store_true",
        help="Install missing local OCR dependencies with the current OS package manager.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print dependency installation commands without running them.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=90,
        help="OCR timeout in seconds per engine attempt. Default: 90.",
    )
    return parser.parse_args()


def fail(message: str, code: int = 1) -> None:
    print(f"image-ocr: {message}", file=sys.stderr)
    raise SystemExit(code)


def find_tesseract() -> str | None:
    found = shutil.which("tesseract")
    if found:
        return found

    if platform.system() != "Windows":
        return None

    candidates = [
        os.environ.get("TESSERACT_EXE"),
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
        str(Path.home() / "AppData" / "Local" / "Programs" / "Tesseract-OCR" / "tesseract.exe"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    return None


def doctor() -> int:
    tesseract = find_tesseract()
    print("image-ocr doctor")
    print(f"- platform: {platform.platform()}")
    print(f"- python: {sys.version.split()[0]} ({sys.executable})")
    if platform.system() == "Windows":
        print(f"- py launcher: {shutil.which('py') or 'not found'}")
    print(f"- swift: {shutil.which('swift') or 'not found'}")
    print(f"- tesseract: {tesseract or 'not found'}")
    if platform.system() == "Darwin" and shutil.which("swift"):
        print("- preferred engine: macOS Vision")
    elif tesseract:
        print("- preferred engine: Tesseract")
    else:
        print("")
        print(INSTALL_HELP.rstrip())
        return 1
    return 0


def command_display(cmd: list[str]) -> str:
    if platform.system() == "Windows":
        return subprocess.list2cmdline(cmd)
    return shlex.join(cmd)


def run_install_command(cmd: list[str], dry_run: bool) -> None:
    if dry_run:
        print(f"[dry-run] {command_display(cmd)}")
        return
    proc = subprocess.run(cmd, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"dependency install failed: {command_display(cmd)}")


def install_deps(dry_run: bool = False) -> int:
    system = platform.system()
    has_vision = system == "Darwin" and shutil.which("swift")
    has_tesseract = bool(find_tesseract())

    if has_vision or has_tesseract:
        print("image-ocr dependencies already satisfy OCR requirements.")
        return doctor()

    if system == "Windows":
        winget = shutil.which("winget")
        if not winget:
            fail("automatic Windows dependency installation requires winget.")
        run_install_command(
            [
                winget,
                "install",
                "--id",
                "tesseract-ocr.tesseract",
                "--exact",
                "--accept-package-agreements",
                "--accept-source-agreements",
                "--silent",
            ],
            dry_run,
        )
    elif system == "Darwin":
        if shutil.which("xcode-select") and not shutil.which("swift"):
            run_install_command(["xcode-select", "--install"], dry_run)
        elif shutil.which("brew"):
            run_install_command(["brew", "install", "tesseract"], dry_run)
        else:
            fail("automatic macOS installation requires Xcode Command Line Tools or Homebrew.")
    elif system == "Linux":
        if shutil.which("apt-get"):
            run_install_command(["sudo", "apt-get", "update"], dry_run)
            run_install_command(
                [
                    "sudo",
                    "apt-get",
                    "install",
                    "-y",
                    "tesseract-ocr",
                    "tesseract-ocr-eng",
                    "tesseract-ocr-chi-sim",
                ],
                dry_run,
            )
        elif shutil.which("dnf"):
            run_install_command(["sudo", "dnf", "install", "-y", "tesseract"], dry_run)
        elif shutil.which("yum"):
            run_install_command(["sudo", "yum", "install", "-y", "tesseract"], dry_run)
        elif shutil.which("pacman"):
            run_install_command(["sudo", "pacman", "-S", "--needed", "tesseract"], dry_run)
        else:
            fail("automatic Linux installation requires apt-get, dnf, yum, or pacman.")
    else:
        fail(f"automatic dependency installation is not supported on {system}.")

    if dry_run:
        return 0

    print("")
    print("Dependency installation finished. Restart the terminal if PATH changed, then rerun:")
    print("  image-ocr --doctor")
    return doctor()


def swift_env_candidates() -> list[dict[str, str]]:
    base = os.environ.copy()
    candidates = [base]
    sdk_candidates = [
        "/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk",
        "/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk",
    ]
    seen = {base.get("SDKROOT", "")}
    for sdk in sdk_candidates:
        if sdk in seen or not Path(sdk).exists():
            continue
        env = base.copy()
        env["SDKROOT"] = sdk
        candidates.append(env)
        seen.add(sdk)
    return candidates


def parse_helper_json(stdout: str) -> dict[str, Any]:
    start = stdout.find("{")
    if start < 0:
        raise ValueError(f"helper returned no JSON object:\n{stdout[:1000]}")
    decoder = json.JSONDecoder()
    data, end = decoder.raw_decode(stdout[start:])
    tail = stdout[start + end :].strip()
    if tail:
        warnings = data.setdefault("warnings", [])
        warnings.append(f"Ignored non-JSON helper output: {tail[:300]}")
    return data


def decode_process_output(value: bytes | str | None) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value

    candidates = [
        "utf-8",
        locale.getpreferredencoding(False),
        "gbk",
        "latin-1",
    ]
    seen: set[str] = set()
    for encoding in candidates:
        normalized = encoding.lower()
        if normalized in seen:
            continue
        seen.add(normalized)
        try:
            return value.decode(encoding)
        except UnicodeDecodeError:
            continue
    return value.decode("utf-8", errors="replace")


def write_stdout(value: str) -> None:
    try:
        sys.stdout.write(value)
        return
    except UnicodeEncodeError:
        encoding = getattr(sys.stdout, "encoding", None) or locale.getpreferredencoding(False)
        safe_value = value.encode(encoding, errors="replace").decode(encoding, errors="replace")
        sys.stdout.write(safe_value)


def ocr_score(data: dict[str, Any]) -> float:
    lines = data.get("text", [])
    raw_text = data.get("rawText") or ""
    confidence = 0.0
    if lines:
        confidence = sum(float(line.get("confidence", 0.0)) for line in lines) / len(lines)
    unique_chars = len(set(raw_text.strip()))
    cjk_chars = sum(1 for ch in raw_text if "\u3400" <= ch <= "\u9fff")
    mojibake_chars = sum(1 for ch in raw_text if ch in "�£Æ‡¤¢€￿")
    return len(raw_text.strip()) * max(confidence, 0.2) + unique_chars + cjk_chars * 4 - mojibake_chars * 6


def run_vision_once(
    image_path: Path, languages: str, level: str, timeout: int
) -> dict[str, Any]:
    swift = shutil.which("swift")
    if not swift:
        raise RuntimeError("Swift is not available. macOS Vision OCR requires `/usr/bin/swift`.")
    if not SWIFT_HELPER.exists():
        raise RuntimeError(f"missing helper script: {SWIFT_HELPER}")

    cmd = [
        swift,
        str(SWIFT_HELPER),
        str(image_path),
        "--languages",
        languages,
        "--level",
        level,
    ]
    failures: list[str] = []
    for env in swift_env_candidates():
        try:
            proc = subprocess.run(
                cmd,
                check=False,
                capture_output=True,
                text=True,
                timeout=timeout,
                env=env,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(f"Vision OCR timed out after {timeout} seconds") from exc
        if proc.returncode == 0:
            return parse_helper_json(proc.stdout)
        sdk = env.get("SDKROOT", "(default SDKROOT)")
        detail = proc.stderr.strip() or proc.stdout.strip() or f"exit code {proc.returncode}"
        failures.append(f"SDKROOT={sdk}: {detail}")
    raise RuntimeError("\n\n".join(failures))


def run_vision(
    image_path: Path, languages: str, level: str, timeout: int, passes: str
) -> dict[str, Any]:
    attempts: list[tuple[str, dict[str, Any]]] = []
    attempts.append((languages, run_vision_once(image_path, languages, level, timeout)))

    if passes == "best" and languages:
        try:
            attempts.append(("auto", run_vision_once(image_path, "", level, timeout)))
        except Exception as exc:
            attempts[0][1].setdefault("warnings", []).append(
                f"Automatic Vision language pass failed: {exc}"
            )

    label, best = max(attempts, key=lambda item: ocr_score(item[1]))
    requested_has_cjk = any(part.strip().lower().startswith("zh") for part in languages.split(","))
    if requested_has_cjk and attempts:
        requested = attempts[0][1]
        requested_text = requested.get("rawText") or ""
        best_text = best.get("rawText") or ""
        requested_cjk = sum(1 for ch in requested_text if "\u3400" <= ch <= "\u9fff")
        best_cjk = sum(1 for ch in best_text if "\u3400" <= ch <= "\u9fff")
        if requested_cjk > 0 and best_cjk == 0:
            label, best = attempts[0]
    best.setdefault("warnings", []).append(
        f"OCR engine: macOS Vision; selected language pass: {label or 'auto'}"
    )
    return best


def tesseract_lang(languages: str) -> str:
    mapping = {
        "zh-hans": "chi_sim",
        "zh_cn": "chi_sim",
        "zh-cn": "chi_sim",
        "zh-hant": "chi_tra",
        "zh_tw": "chi_tra",
        "zh-tw": "chi_tra",
        "en": "eng",
        "en-us": "eng",
        "english": "eng",
        "ja": "jpn",
        "jp": "jpn",
        "ko": "kor",
    }
    result: list[str] = []
    for raw in languages.replace("+", ",").split(","):
        key = raw.strip().lower()
        if not key:
            continue
        result.append(mapping.get(key, raw.strip()))
    return "+".join(dict.fromkeys(result)) or "eng"


def image_metadata(image_path: Path) -> dict[str, Any]:
    suffix = image_path.suffix.lower().lstrip(".") or None
    info: dict[str, Any] = {
        "path": str(image_path),
        "filename": image_path.name,
        "formatGuess": suffix,
        "width": "?",
        "height": "?",
        "colorSpace": None,
        "hasAlpha": None,
        "bytes": image_path.stat().st_size if image_path.exists() else None,
    }
    sips = shutil.which("sips")
    if platform.system() == "Darwin" and sips:
        proc = subprocess.run(
            [sips, "-g", "pixelWidth", "-g", "pixelHeight", "-g", "format", str(image_path)],
            check=False,
            capture_output=True,
            text=True,
        )
        if proc.returncode == 0:
            for line in proc.stdout.splitlines():
                stripped = line.strip()
                if stripped.startswith("pixelWidth:"):
                    info["width"] = stripped.split(":", 1)[1].strip()
                elif stripped.startswith("pixelHeight:"):
                    info["height"] = stripped.split(":", 1)[1].strip()
                elif stripped.startswith("format:"):
                    info["formatGuess"] = stripped.split(":", 1)[1].strip().lower()
    return info


def run_tesseract(image_path: Path, languages: str, timeout: int) -> dict[str, Any]:
    tesseract = find_tesseract()
    if not tesseract:
        raise RuntimeError(
            "Tesseract is not installed or not available. Run `image-ocr --install-deps --doctor`."
        )

    lang = tesseract_lang(languages)
    cmd = [tesseract, str(image_path), "stdout", "-l", lang]
    try:
        proc = subprocess.run(
            cmd,
            check=False,
            capture_output=True,
            text=False,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"Tesseract OCR timed out after {timeout} seconds") from exc

    if proc.returncode != 0:
        detail = (
            decode_process_output(proc.stderr).strip()
            or decode_process_output(proc.stdout).strip()
            or f"exit code {proc.returncode}"
        )
        raise RuntimeError(detail)

    raw_text = decode_process_output(proc.stdout).strip()
    lines = [
        {"text": line.strip(), "confidence": 0.0, "boundingBox": []}
        for line in raw_text.splitlines()
        if line.strip()
    ]
    return {
        "image": image_metadata(image_path),
        "text": lines,
        "rawText": raw_text,
        "dominantColors": [],
        "stats": {},
        "categoryGuess": "image_with_some_text" if raw_text else "unknown",
        "warnings": [f"OCR engine: Tesseract; languages: {lang}"],
    }


def run_ocr(args: argparse.Namespace, image_path: Path) -> dict[str, Any]:
    errors: list[str] = []
    can_use_vision = platform.system() == "Darwin" and shutil.which("swift")

    if args.engine in ("auto", "vision") and can_use_vision:
        try:
            return run_vision(
                image_path,
                args.lang,
                args.level,
                args.timeout,
                args.vision_passes,
            )
        except Exception as exc:
            errors.append(f"macOS Vision failed: {exc}")
            if args.engine == "vision":
                raise RuntimeError(errors[-1]) from exc

    if args.engine in ("auto", "tesseract"):
        try:
            return run_tesseract(image_path, args.lang, args.timeout)
        except Exception as exc:
            errors.append(f"Tesseract failed: {exc}")
            if args.engine == "tesseract":
                raise RuntimeError(errors[-1]) from exc

    raise RuntimeError("\n\n".join(errors + [INSTALL_HELP]))


def pct(value: float | int | None) -> str:
    if value is None:
        return "n/a"
    return f"{float(value) * 100:.1f}%"


def format_report(data: dict[str, Any]) -> str:
    image = data.get("image", {})
    stats = data.get("stats", {}) or {}
    colors = data.get("dominantColors", []) or []
    lines = data.get("text", []) or []
    warnings = data.get("warnings", []) or []

    output: list[str] = []
    output.append("image-ocr report")
    output.append("")
    output.append("Image")
    output.append(f"- path: {image.get('path', '')}")
    output.append(f"- size: {image.get('width', '?')} x {image.get('height', '?')} px")
    output.append(f"- format: {image.get('formatGuess') or 'unknown'}")
    if image.get("colorSpace"):
        output.append(f"- color space: {image.get('colorSpace')}")
    output.append(f"- category guess: {data.get('categoryGuess', 'unknown')}")
    output.append("")

    output.append("OCR")
    raw_text = (data.get("rawText") or "").strip()
    output.append(raw_text if raw_text else "(no text recognized)")
    output.append("")

    if lines:
        output.append("OCR lines")
        for idx, line in enumerate(lines, start=1):
            confidence = float(line.get("confidence", 0.0))
            text = line.get("text", "")
            if confidence > 0:
                output.append(f"{idx}. [{confidence:.2f}] {text}")
            else:
                output.append(f"{idx}. {text}")
        output.append("")

    if stats:
        output.append("Image characteristics")
        output.append(f"- sampled pixels: {stats.get('sampleCount', 0)}")
        output.append(f"- unique color buckets: {stats.get('uniqueColorBuckets', 0)}")
        output.append(f"- mean saturation: {pct(stats.get('meanSaturation'))}")
        output.append(f"- near-gray ratio: {pct(stats.get('nearGrayRatio'))}")
        output.append(f"- dark ratio: {pct(stats.get('darkRatio'))}")
        output.append(f"- light ratio: {pct(stats.get('lightRatio'))}")
        output.append(f"- edge density: {pct(stats.get('edgeDensity'))}")

    if colors:
        output.append("")
        output.append("Dominant colors")
        for color in colors[:8]:
            output.append(f"- {color.get('hex')} ({pct(color.get('percent'))})")

    if warnings:
        output.append("")
        output.append("Notes")
        for warning in warnings:
            output.append(f"- {warning}")

    return "\n".join(output).rstrip() + "\n"


def main() -> None:
    args = parse_args()
    if args.install_deps:
        raise SystemExit(install_deps(args.dry_run))
    if args.doctor:
        raise SystemExit(doctor())
    if not args.image:
        fail("missing image path. Run `image-ocr --doctor` to check dependencies.")
    image_path = Path(os.path.expanduser(args.image)).resolve()
    if not image_path.exists():
        fail(f"file not found: {image_path}")
    if not image_path.is_file():
        fail(f"not a file: {image_path}")

    try:
        data = run_ocr(args, image_path)
    except Exception as exc:
        fail(str(exc))
    if args.json:
        write_stdout(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    else:
        write_stdout(format_report(data))


if __name__ == "__main__":
    main()
