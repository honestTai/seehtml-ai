#!/usr/bin/env node
/**
 * SeeHTML AI — Dependency Downloader
 * Downloads Python embeddable + FFmpeg for bundling into the app
 * Run: node scripts/download-deps.js
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createWriteStream, existsSync, mkdirSync, readdirSync } = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PYTHON_DIR = path.join(ROOT, 'python');
const FFMPEG_DIR = path.join(ROOT, 'ffmpeg');

function download(url, dest) {
  return new Promise((resolve, reject) => {
    if (existsSync(dest)) {
      console.log(`  Skip (exists): ${path.basename(dest)}`);
      return resolve();
    }
    console.log(`  Downloading: ${url}`);
    const proto = url.startsWith('https') ? https : http;
    const file = createWriteStream(dest);
    proto.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        file.close();
        fs.unlinkSync(dest);
        return download(response.headers.location, dest).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${response.statusCode}`));
      }
      const total = parseInt(response.headers['content-length'] || '0', 10);
      let downloaded = 0;
      response.on('data', (chunk) => {
        downloaded += chunk.length;
        if (total > 0) process.stdout.write(`\r    ${((downloaded / total) * 100).toFixed(0)}%`);
      });
      response.pipe(file);
      file.on('finish', () => { file.close(); process.stdout.write('\r    Done!          \n'); resolve(); });
      file.on('error', reject);
    }).on('error', reject);
  });
}

async function setupPython() {
  console.log('\n[1/2] Setting up Python embeddable + OCR...');

  const PY_VER = '3.12.8';
  const PY_URL = `https://www.python.org/ftp/python/${PY_VER}/python-${PY_VER}-embed-amd64.zip`;
  const PY_ZIP = path.join(ROOT, 'python-embed.zip');

  if (!existsSync(path.join(PYTHON_DIR, 'python.exe'))) {
    mkdirSync(PYTHON_DIR, { recursive: true });
    await download(PY_URL, PY_ZIP);
    
    // Extract using .NET ZipFile (always available, no module needed)
    console.log('  Extracting Python...');
    execSync(`powershell -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${PY_ZIP.replace(/\\/g, '\\\\')}', '${PYTHON_DIR.replace(/\\/g, '\\\\')}')"`, { stdio: 'pipe' });
    fs.unlinkSync(PY_ZIP);

    // Enable site-packages for pip
    const pthFile = path.join(PYTHON_DIR, 'python312._pth');
    let pthContent = fs.readFileSync(pthFile, 'utf-8');
    pthContent = pthContent.replace('#import site', 'import site');
    pthContent += '\nLib\\site-packages\n';
    fs.writeFileSync(pthFile, pthContent);

    // Download and install pip
    console.log('  Installing pip...');
    const getPip = path.join(PYTHON_DIR, 'get-pip.py');
    await download('https://bootstrap.pypa.io/get-pip.py', getPip);
    execSync(`"${path.join(PYTHON_DIR, 'python.exe')}" "${getPip}" --no-warn-script-location`, { stdio: 'pipe' });
    fs.unlinkSync(getPip);

    // Install OCR packages (easyocr = no external deps needed)
    console.log('  Installing OCR packages (easyocr + pillow)...');
    execSync(`"${path.join(PYTHON_DIR, 'python.exe')}" -m pip install easyocr pillow --no-warn-script-location --quiet`, { stdio: 'pipe' });

    // Copy ocr_service.py into python dir
    const ocrSrc = path.join(ROOT, 'python', 'ocr_service.py');
    if (existsSync(ocrSrc)) {
      fs.copyFileSync(ocrSrc, path.join(PYTHON_DIR, 'ocr_service.py'));
    }

    console.log('  Python + OCR ready!');
  } else {
    console.log('  Python already configured.');
    // Ensure ocr_service.py is copied
    const ocrSrc = path.join(ROOT, 'python', 'ocr_service.py');
    const ocrDst = path.join(PYTHON_DIR, 'ocr_service.py');
    if (existsSync(ocrSrc) && !existsSync(ocrDst)) {
      fs.copyFileSync(ocrSrc, ocrDst);
    }
  }
}

async function setupFFmpeg() {
  console.log('\n[2/2] Setting up FFmpeg...');

  if (existsSync(path.join(FFMPEG_DIR, 'bin', 'ffmpeg.exe'))) {
    console.log('  FFmpeg already configured.');
    return;
  }

  mkdirSync(FFMPEG_DIR, { recursive: true });
  
  const FF_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
  const FF_ZIP = path.join(ROOT, 'ffmpeg-temp.zip');
  
  console.log('  Downloading FFmpeg (~30MB)...');
  await download(FF_URL, FF_ZIP);

  console.log('  Extracting FFmpeg...');
  const tempDir = path.join(ROOT, 'ffmpeg-temp');
  mkdirSync(tempDir, { recursive: true });
  execSync(`powershell -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${FF_ZIP.replace(/\\/g, '\\\\')}', '${tempDir.replace(/\\/g, '\\\\')}')"`, { stdio: 'pipe' });
  fs.unlinkSync(FF_ZIP);

  // Find the extracted directory (it has a versioned name like ffmpeg-7.x-essentials_build)
  const items = readdirSync(tempDir);
  const extractedDir = items.find(d => d.startsWith('ffmpeg-'));
  
  if (extractedDir) {
    const src = path.join(tempDir, extractedDir);
    const dest = path.join(FFMPEG_DIR, 'bin');
    
    // Move bin directory
    const srcBin = path.join(src, 'bin');
    if (existsSync(srcBin)) {
      // Copy all files from src to ffmpeg/bin
      const files = readdirSync(srcBin);
      mkdirSync(dest, { recursive: true });
      for (const f of files) {
        fs.copyFileSync(path.join(srcBin, f), path.join(dest, f));
      }
    }
  }

  // Cleanup
  execSync(`powershell -Command "Remove-Item -Path '${tempDir}' -Recurse -Force"`, { stdio: 'pipe' });
  console.log('  FFmpeg ready!');
}

async function main() {
  console.log('=== SeeHTML AI Dependency Downloader ===\n');
  
  try {
    await setupPython();
    await setupFFmpeg();
    
    // Verify
    const pyOk = existsSync(path.join(PYTHON_DIR, 'python.exe'));
    const ffOk = existsSync(path.join(FFMPEG_DIR, 'bin', 'ffmpeg.exe'));
    
    console.log('\n=== Results ===');
    console.log(`Python OCR: ${pyOk ? '✅ Ready' : '❌ Missing'}`);
    console.log(`FFmpeg:     ${ffOk ? '✅ Ready' : '❌ Missing (optional)'}`);
    
    if (pyOk) {
      // Test Python
      try {
        const result = execSync(`"${path.join(PYTHON_DIR, 'python.exe')}" -c "print('Python OK')"`, { encoding: 'utf-8' });
        console.log(`  Python test: ${result.trim()}`);
      } catch (e) {
        console.log('  Python test: failed (may still work)');
      }
    }

    console.log('\nReady to build: cargo tauri build\n');
  } catch (e) {
    console.error('\n❌ Setup failed:', e.message);
    console.log('You can still build without these dependencies.');
    console.log('The app will use system Python/FFmpeg if available.');
    process.exit(0); // Don't fail the build
  }
}

main();
