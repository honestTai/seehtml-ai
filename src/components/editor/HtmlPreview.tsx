import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileDown, FileText, ImageDown, Video } from 'lucide-react';
import { toPng } from 'html-to-image';
import { useI18n } from '../../lib/i18n';
import { splitHtmlPages } from '../../lib/htmlPages';
import { notifyProjectFilesChanged, projectExportDir, projectExportPath, projectFramesDir } from '../../lib/projectPaths';
import { usePreviewStore } from '../../stores/previewStore';
import { useUIStore } from '../../stores/uiStore';

interface Props {
  htmlContent: string;
  sections?: { id: string; heading?: string; content: string }[];
  currentSlide: number;
  onSlideChange: (index: number) => void;
  onCapture: (dataUrl: string, index: number) => void;
  baseHref?: string;
  backgroundOnly?: boolean;
  processRenderRequests?: boolean;
}

export function HtmlPreview({
  htmlContent,
  sections,
  currentSlide,
  onSlideChange,
  onCapture,
  baseHref,
  backgroundOnly = false,
  processRenderRequests = true,
}: Props) {
  const { t } = useI18n();
  const exportFrameRef = useRef<HTMLIFrameElement>(null);
  const handledRenderRequests = useRef<Set<string>>(new Set());
  const renderRequest = usePreviewStore((s) => s.renderRequest);
  const clearRenderRequest = usePreviewStore((s) => s.clearRenderRequest);
  const setRenderStatus = usePreviewStore((s) => s.setRenderStatus);
  const projectPath = useUIStore((s) => s.projectPath);
  const [capturing, setCapturing] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState('');

  const renderWholeDocument = hasRealTimeline(htmlContent);
  const preparedHtml = withBaseHref(htmlContent, baseHref);
  const slides = renderWholeDocument
    ? [{ id: 'document', title: 'HTML', html: preparedHtml }]
    : sections && sections.length > 0
    ? sections.map((section) => ({ id: section.id, title: section.heading || section.id, html: section.content }))
    : splitHtmlPages(htmlContent, { baseHref });
  const safeSlide = Math.min(currentSlide, Math.max(slides.length - 1, 0));
  const hasMultiplePages = !renderWholeDocument && slides.length > 1;
  const currentContent = renderWholeDocument || slides.length <= 1
    ? preparedHtml
    : slides[safeSlide]?.html || preparedHtml;

  useEffect(() => {
    if (currentSlide !== safeSlide) onSlideChange(safeSlide);
  }, [currentSlide, safeSlide, onSlideChange]);

  const publishExportStatus = (
    message: string,
    state: 'running' | 'done' | 'error' = 'running',
    outputPath?: string,
  ) => {
    setExportStatus(message);
    setRenderStatus({ state, message, outputPath });
  };

  const handleCapture = async () => {
    if (capturing || exporting) return;
    if (!projectPath) {
      setExportStatus(t('project.required'));
      return;
    }
    setCapturing(true);
    setExportStatus(t('export.renderingPage'));
    try {
      const dataUrl = await capturePagePng(currentContent);
      onCapture(dataUrl, safeSlide);
      const { invoke } = await import('@tauri-apps/api/core');
      const path = await invoke<string>('save_image', {
        dataUrl,
        index: safeSlide,
        outputDir: projectExportDir(projectPath),
      });
      notifyProjectFilesChanged(projectPath);
      setExportStatus(`${t('chat.exported')} ${path}`);
    } catch (e) {
      setExportStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setCapturing(false);
    }
  };

  const exportDocument = async (format: 'pptx' | 'markdown') => {
    if (exporting) return;
    if (!projectPath) {
      setExportStatus(t('project.required'));
      return;
    }
    setExporting(format);
    setExportStatus(t('export.exportingByPage'));
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const ext = format === 'markdown' ? 'md' : format;
      const outputPath = projectExportPath(projectPath, `document.${ext}`);
      const result = await invoke<{ output_path?: string }>('export_document', {
        html: htmlContent,
        format,
        theme: null,
        outputPath,
      });
      notifyProjectFilesChanged(projectPath);
      setExportStatus(`${t('chat.exported')} ${result?.output_path || ''}`.trim());
    } catch (e) {
      setExportStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(null);
    }
  };

  const exportAnimatedMp4 = async () => {
    if (exporting) return;
    if (!projectPath) {
      publishExportStatus(t('project.required'), 'error');
      return;
    }
    const exportPages = buildMp4ExportPages(htmlContent, slides, baseHref);
    const fps = 30;
    let frameIndex = 0;

    setExporting('mp4');
    publishExportStatus(t('export.mp4BackgroundRunning'));
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const framesDir = projectFramesDir(projectPath);
      await invoke('clear_rendered_frames', { framesDir });

      for (let pageIndex = 0; pageIndex < exportPages.length; pageIndex += 1) {
        const page = exportPages[pageIndex];
        const framesForPage = Math.max(1, Math.ceil(page.duration * fps));
        publishExportStatus(`${t('export.renderingPage')} ${pageIndex + 1}/${exportPages.length}`);
        await loadExportPage(page.html, { freezeTimeline: true });
        await wait(350);

        for (let frame = 0; frame < framesForPage; frame += 1) {
          const time = Math.min(page.duration, frame / fps);
          applyExportFrame(frame, fps, pageIndex, exportPages.length, time);
          await waitForExportFramePaint();
          const dataUrl = await captureLoadedExportFrame();
          await invoke('save_image', { dataUrl, index: frameIndex, outputDir: framesDir });
          frameIndex += 1;
          if (frame === 0 || frame === framesForPage - 1 || frame % fps === 0) {
            publishExportStatus(`${t('export.renderingFrame')} ${formatSeconds(time)} / ${formatSeconds(page.duration)} · ${frame + 1}/${framesForPage}`);
          }
        }
      }

      publishExportStatus(t('export.encodingMp4'));
      const outputPath = await invoke<string>('generate_video', {
        slideCount: frameIndex,
        frameRate: fps,
        framesDir,
        outputPath: projectExportPath(projectPath, 'presentation.mp4'),
      });
      notifyProjectFilesChanged(projectPath);
      publishExportStatus(`${t('chat.exported')} ${outputPath}`, 'done', outputPath);
    } catch (e) {
      publishExportStatus(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setExporting(null);
    }
  };

  useEffect(() => {
    if (!processRenderRequests || !htmlContent.trim()) return;
    if (!renderRequest || renderRequest.type !== 'mp4' || exporting || capturing) return;
    if (handledRenderRequests.current.has(renderRequest.id)) return;
    handledRenderRequests.current.add(renderRequest.id);
    clearRenderRequest(renderRequest.id);
    void exportAnimatedMp4();
  }, [renderRequest, exporting, capturing, processRenderRequests, htmlContent]);

  const capturePagePng = async (pageHtml: string) => {
    await loadExportPage(pageHtml);
    await wait(300);
    return captureLoadedExportFrame();
  };

  const loadExportPage = async (pageHtml: string, options: { freezeTimeline?: boolean } = {}) => {
    const frame = exportFrameRef.current;
    if (!frame) throw new Error('Export frame is not ready');
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Preview render timeout')), 8000);
      frame.onload = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      frame.srcdoc = options.freezeTimeline ? injectExportRuntime(pageHtml) : pageHtml;
    });
    const doc = frame.contentDocument;
    if (doc?.fonts?.ready) {
      await doc.fonts.ready.catch(() => undefined);
    }
  };

  const captureLoadedExportFrame = async () => {
    const doc = exportFrameRef.current?.contentDocument;
    const node = doc?.body || doc?.documentElement;
    if (!node) throw new Error('No rendered page to capture');

    doc.documentElement.style.width = '1920px';
    doc.documentElement.style.height = '1080px';
    if (doc.body) {
      doc.body.style.width = '1920px';
      doc.body.style.height = '1080px';
      if (!doc.body.style.margin) doc.body.style.margin = '0';
    }

    return toPng(node, {
      quality: 0.96,
      backgroundColor: '#ffffff',
      width: 1920,
      height: 1080,
      canvasWidth: 1920,
      canvasHeight: 1080,
      pixelRatio: 1,
      cacheBust: true,
    });
  };

  const applyExportFrame = (frame: number, fps: number, pageIndex: number, pageCount: number, time: number) => {
    const doc = exportFrameRef.current?.contentDocument;
    if (doc?.getAnimations) {
      for (const animation of doc.getAnimations()) {
        try {
          animation.pause();
          animation.currentTime = time * 1000;
        } catch {
          // Some browser-managed animations may reject manual seeking.
        }
      }
    }

    const win = exportFrameRef.current?.contentWindow as (Window & {
      __SEEHTML_EXPORT_FRAME__?: number;
      __SEEHTML_EXPORT_FPS__?: number;
      __SEEHTML_EXPORT_TIME__?: number;
      __SEEHTML_EXPORT_PAGE__?: number;
      __SEEHTML_EXPORT_PAGE_COUNT__?: number;
      renderAtTime?: (seconds: number) => void;
    }) | null;
    if (!win) return;

    win.__SEEHTML_EXPORT_FRAME__ = frame;
    win.__SEEHTML_EXPORT_FPS__ = fps;
    win.__SEEHTML_EXPORT_TIME__ = time;
    win.__SEEHTML_EXPORT_PAGE__ = pageIndex;
    win.__SEEHTML_EXPORT_PAGE_COUNT__ = pageCount;
    if (typeof win.renderAtTime === 'function') {
      try {
        win.renderAtTime(time);
      } catch {
        // Pages can still use the export event path below.
      }
    }
    win.dispatchEvent(new CustomEvent('seehtml:export-frame', {
      detail: { frame, fps, time, pageIndex, pageCount },
    }));
  };

  const waitForExportFramePaint = async () => {
    const win = exportFrameRef.current?.contentWindow as (Window & {
      __SEEHTML_EXPORT_TICK__?: () => Promise<void>;
    }) | null;
    if (win?.__SEEHTML_EXPORT_TICK__) {
      await win.__SEEHTML_EXPORT_TICK__().catch(() => undefined);
      return;
    }
    if (!win?.requestAnimationFrame) {
      await wait(16);
      return;
    }

    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, 48);
      win.requestAnimationFrame(() => {
        win.requestAnimationFrame(() => {
          window.clearTimeout(timeout);
          resolve();
        });
      });
    });
  };

  if (backgroundOnly) {
    return (
      <iframe
        ref={exportFrameRef}
        title="Background MP4 Renderer"
        sandbox="allow-scripts allow-same-origin"
        className="pointer-events-none fixed -left-[10000px] top-0 h-[1080px] w-[1920px] border-0 opacity-0"
      />
    );
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-[#f2f4f7]">
      <iframe
        ref={exportFrameRef}
        title="Export Renderer"
        sandbox="allow-scripts allow-same-origin"
        className="pointer-events-none fixed -left-[10000px] top-0 h-[1080px] w-[1920px] border-0 opacity-0"
      />

      <iframe
        srcDoc={currentContent}
        className="h-full w-full border-0 bg-white"
        sandbox="allow-scripts allow-same-origin"
        title="HTML Preview"
      />

      <div className="absolute right-3 top-3 flex items-center gap-1 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-white/92 p-1 shadow-sm backdrop-blur">
        {hasMultiplePages && (
          <div className="mr-1 flex items-center gap-0.5 border-r border-[var(--color-border)] pr-1">
          <button
            onClick={() => onSlideChange(Math.max(0, safeSlide - 1))}
            disabled={safeSlide === 0}
              className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] disabled:opacity-30"
              title="Previous page"
          ><ChevronLeft size={15} /></button>
            <span className="px-1.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
            {t('export.page')} {safeSlide + 1} / {Math.max(slides.length, 1)}
          </span>
          <button
            onClick={() => onSlideChange(Math.min(slides.length - 1, safeSlide + 1))}
            disabled={safeSlide >= slides.length - 1}
              className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] disabled:opacity-30"
              title="Next page"
          ><ChevronRight size={15} /></button>
        </div>
        )}
        <ToolButton icon={<ImageDown size={14} />} onClick={handleCapture} disabled={capturing || Boolean(exporting)} label={capturing ? t('export.rendering') : t('export.png')} shortLabel="PNG" />
        <ToolButton icon={<FileDown size={14} />} onClick={() => exportDocument('pptx')} disabled={Boolean(exporting)} label={exporting === 'pptx' ? t('export.exporting') : t('export.pptx')} shortLabel="PPT" />
        <ToolButton icon={<FileText size={14} />} onClick={() => exportDocument('markdown')} disabled={Boolean(exporting)} label={exporting === 'markdown' ? t('export.exporting') : t('export.markdown')} shortLabel="MD" />
        <ToolButton icon={<Video size={14} />} primary onClick={exportAnimatedMp4} disabled={Boolean(exporting)} label={exporting === 'mp4' ? t('export.encodingMp4') : t('export.video')} shortLabel="MP4" />
      </div>

      {exportStatus && (
        <div className={`absolute inset-x-3 ${hasMultiplePages ? 'bottom-[92px]' : 'bottom-3'} truncate rounded-[var(--radius-control)] border border-[var(--color-border)] bg-white/94 px-3 py-2 text-[11px] text-[var(--color-text-secondary)] shadow-sm backdrop-blur`}>
          {exportStatus}
      </div>
      )}

      {hasMultiplePages && (
        <div className="absolute inset-x-3 bottom-3 flex gap-1 overflow-x-auto rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-white/92 px-2 py-2 shadow-sm backdrop-blur">
          {slides.map((slide, i) => (
            <button
              key={slide.id}
              onClick={() => onSlideChange(i)}
              className={`h-14 w-24 flex-shrink-0 overflow-hidden rounded-lg border-2 transition-colors ${
                i === safeSlide ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)] hover:border-[var(--color-text-secondary)]'
              }`}
              title={slide.title}
            >
              <iframe
                srcDoc={slide.html}
                className="pointer-events-none h-full w-full border-0"
                sandbox="allow-scripts allow-same-origin"
                title={`Slide ${i + 1}`}
                style={{ transform: 'scale(0.25)', transformOrigin: '0 0', width: '384px', height: '216px' }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ToolButton({
  label,
  shortLabel,
  icon,
  onClick,
  disabled,
  primary,
}: {
  label: string;
  shortLabel: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-[11px] font-medium transition-colors disabled:opacity-45 ${
        primary
          ? 'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]'
          : 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]'
      }`}
    >
      {icon}
      <span>{shortLabel}</span>
    </button>
  );
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function buildMp4ExportPages(
  htmlContent: string,
  slides: { id: string; title: string; html: string }[],
  baseHref?: string,
) {
  const timeline = hasRealTimeline(htmlContent);
  if (timeline || slides.length <= 1) {
    return [{
      id: 'document',
      title: 'Document',
      html: withBaseHref(htmlContent, baseHref),
      duration: detectExportDuration(htmlContent, timeline ? 30 : 4),
    }];
  }

  return slides.map((slide) => ({
    ...slide,
    duration: detectExportDuration(slide.html, 4),
  }));
}

function hasRealTimeline(html: string): boolean {
  return /renderAtTime|seehtml:export-frame|__SEEHTML_EXPORT|requestAnimationFrame|<canvas[\s>]|animation(?:-duration)?\s*:/i.test(html);
}

function detectExportDuration(html: string, fallback: number): number {
  const candidates: number[] = [];
  const patterns = [
    /__SEEHTML_EXPORT_DURATION__\s*=\s*(\d+(?:\.\d+)?)/gi,
    /\b(?:const|let|var)\s+DURATION\s*=\s*(\d+(?:\.\d+)?)/gi,
    /\bDURATION\s*:\s*(\d+(?:\.\d+)?)/gi,
    /(\d+(?:\.\d+)?)s\s*\/\s*(\d+(?:\.\d+)?)s/gi,
    /animation-duration\s*:\s*(\d+(?:\.\d+)?)s/gi,
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const value = Number(match[2] || match[1]);
      if (Number.isFinite(value)) candidates.push(value);
    }
  }

  const duration = Math.max(fallback, ...candidates);
  return Math.min(Math.max(duration, 1), 120);
}

function withBaseHref(html: string, baseHref?: string): string {
  if (!baseHref || /<base\s/i.test(html)) return html;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>\n<base href="${escapeAttribute(baseHref)}" />`);
  }
  return `<!DOCTYPE html><html><head><base href="${escapeAttribute(baseHref)}" /></head><body>${html}</body></html>`;
}

function injectExportRuntime(html: string): string {
  const prelude = `<script>
(() => {
  window.__SEEHTML_EXPORT_MODE__ = true;
  const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
  const queuedAnimationFrames = new Map();
  let nextAnimationFrameId = 1;
  window.__SEEHTML_EXPORT_TICK__ = () => new Promise((resolve) => {
    nativeRequestAnimationFrame(() => nativeRequestAnimationFrame(resolve));
  });
  window.requestAnimationFrame = (callback) => {
    const id = nextAnimationFrameId++;
    queuedAnimationFrames.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    queuedAnimationFrames.delete(id);
  };
})();
</script>`;

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>\n${prelude}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1>\n<head>${prelude}</head>`);
  }
  return `<!DOCTYPE html><html><head>${prelude}</head><body>${html}</body></html>`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function formatSeconds(value: number): string {
  return `${value.toFixed(1)}s`;
}

