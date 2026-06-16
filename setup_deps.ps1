# SeeHTML AI - Dependency Setup Script
# Downloads and configures Python OCR + FFmpeg for bundling

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "=== SeeHTML AI Dependency Setup ===" -ForegroundColor Cyan

# ── 1. Python Embeddable ──
$PythonDir = "$Root\python"
$PythonZip = "$Root\python-embed.zip"
$PythonUrl = "https://www.python.org/ftp/python/3.12.8/python-3.12.8-embed-amd64.zip"

if (-not (Test-Path "$PythonDir\python.exe")) {
    Write-Host "[1/3] Downloading Python 3.12 embeddable..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $PythonUrl -OutFile $PythonZip
    Expand-Archive -Path $PythonZip -DestinationPath $PythonDir -Force
    Remove-Item $PythonZip
    
    # Enable pip in embeddable Python
    $PthFile = "$PythonDir\python312._pth"
    (Get-Content $PthFile) -replace '#import site', 'import site' | Set-Content $PthFile
    
    Write-Host "[1/3] Installing pip..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile "$PythonDir\get-pip.py"
    & "$PythonDir\python.exe" "$PythonDir\get-pip.py" --no-warn-script-location
    Remove-Item "$PythonDir\get-pip.py"
    
    Write-Host "[1/3] Installing OCR packages..." -ForegroundColor Yellow
    & "$PythonDir\python.exe" -m pip install pytesseract easyocr pillow --no-warn-script-location
    
    Write-Host "[1/3] Python + OCR ready!" -ForegroundColor Green
} else {
    Write-Host "[1/3] Python already configured." -ForegroundColor Green
}

# ── 2. FFmpeg ──
$FfmpegDir = "$Root\ffmpeg"
if (-not (Test-Path "$FfmpegDir\bin\ffmpeg.exe")) {
    Write-Host "[2/3] Downloading FFmpeg..." -ForegroundColor Yellow
    $FfmpegUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
    $FfmpegZip = "$Root\ffmpeg-temp.zip"
    Invoke-WebRequest -Uri $FfmpegUrl -OutFile $FfmpegZip
    Expand-Archive -Path $FfmpegZip -DestinationPath "$Root\ffmpeg-temp" -Force
    
    # Find the extracted directory
    $Extracted = Get-ChildItem "$Root\ffmpeg-temp" | Where-Object { $_.PSIsContainer } | Select-Object -First 1
    Move-Item -Path "$($Extracted.FullName)\*" -Destination $FfmpegDir -Force
    Remove-Item "$Root\ffmpeg-temp" -Recurse -Force
    Remove-Item $FfmpegZip
    
    Write-Host "[2/3] FFmpeg ready!" -ForegroundColor Green
} else {
    Write-Host "[2/3] FFmpeg already configured." -ForegroundColor Green
}

# ── 3. Tesseract (OCR engine) ──
Write-Host "[3/3] Note: Tesseract OCR engine needs manual install" -ForegroundColor Yellow
Write-Host "  Download from: https://github.com/UB-Mannheim/tesseract/wiki" -ForegroundColor Gray
Write-Host "  Or use EasyOCR (already installed via pip) which needs no external engine" -ForegroundColor Gray

Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Cyan
Write-Host "Python: $PythonDir" -ForegroundColor Green
Write-Host "FFmpeg: $FfmpegDir" -ForegroundColor Green
Write-Host ""
Write-Host "Run: cargo tauri build" -ForegroundColor White
