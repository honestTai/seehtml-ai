import { useEffect, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import { useI18n } from '../../lib/i18n';
import { splitHtmlPages } from '../../lib/htmlPages';
import { usePreviewStore } from '../../stores/previewStore';

interface Props {
  htmlContent: string;
  sections?: { id: string; heading?: string; content: string }[];
  currentSlide: number;
  onSlideChange: (index: number) => void;
  onCapture: (dataUrl: string, index: number) => void;
  sourceUrl?: string;
  baseHref?: string;
}

export function HtmlPreview({ htmlContent, sections, currentSlide, onSlideChange, onCapture, sourceUrl, baseHref }: Props) {
  const { t } = useI18n();
  const exportFrameRef = useRef<HTMLIFrameElement>(null);
  const openPreviewFile = usePreviewStore((s) => s.openFile);
  const [capturing, setCapturing] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState('');

  const slides = sections && sections.length > 0
    ? sections.map((section) => ({ id: section.id, title: section.heading || section.id, html: section.content }))
    : splitHtmlPages(htmlContent, { baseHref });
  const safeSlide = Math.min(currentSlide, Math.max(slides.length - 1, 0));
  const currentContent = slides[safeSlide]?.html || htmlContent;
  const useWholeProjectUrl = Boolean(sourceUrl && slides.length <= 1);

  useEffect(() => {
    if (currentSlide !== safeSlide) onSlideChange(safeSlide);
  }, [currentSlide, safeSlide, onSlideChange]);

  const handleCapture = async () => {
    if (capturing || exporting) return;
    setCapturing(true);
    setExportStatus(t('export.renderingPage'));
    try {
      const dataUrl = await capturePagePng(currentContent);
      onCapture(dataUrl, safeSlide);
      const { invoke } = await import('@tauri-apps/api/core');
      const path = await invoke<string>('save_image', { dataUrl, index: safeSlide });
      setExportStatus(`${t('chat.exported')} ${path}`);
    } catch (e) {
      setExportStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setCapturing(false);
    }
  };

  const exportDocument = async (format: 'pptx' | 'markdown') => {
    if (exporting) return;
    setExporting(format);
    setExportStatus(t('export.exportingByPage'));
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<{ output_path?: string }>('export_document', {
        html: htmlContent,
        format,
        theme: null,
        outputPath: null,
      });
      setExportStatus(`${t('chat.exported')} ${result?.output_path || ''}`.trim());
    } catch (e) {
      setExportStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(null);
    }
  };

  const exportAnimatedMp4 = async () => {
    if (exporting) return;
    const pages = slides.length > 0 ? slides : [{ id: 'page-1', title: 'Page 1', html: htmlContent }];
    const fps = 60;
    const secondsPerPage = 4;
    const framesPerPage = fps * secondsPerPage;
    let frameIndex = 0;

    setExporting('mp4');
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
        setExportStatus(`${t('export.renderingPage')} ${pageIndex + 1}/${pages.length}`);
        await loadExportPage(pages[pageIndex].html);
        await wait(350);

        for (let frame = 0; frame < framesPerPage; frame += 1) {
          applyExportFrame(frame, fps, pageIndex, pages.length);
          await wait(8);
          const dataUrl = await captureLoadedExportFrame();
          await invoke('save_image', { dataUrl, index: frameIndex });
          frameIndex += 1;
          setExportStatus(`${t('export.renderingPage')} ${pageIndex + 1}/${pages.length} · ${frame + 1}/${framesPerPage}`);
        }
      }

      setExportStatus(t('export.encodingMp4'));
      const outputPath = await invoke<string>('generate_video', {
        slideCount: frameIndex,
        frameRate: fps,
        outputPath: null,
      });
      setExportStatus(`${t('chat.exported')} ${outputPath}`);
      await openPreviewFile(outputPath, fileName(outputPath));
    } catch (e) {
      setExportStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(null);
    }
  };

  const capturePagePng = async (pageHtml: string) => {
    await loadExportPage(pageHtml);
    await wait(300);
    return captureLoadedExportFrame();
  };

  const loadExportPage = async (pageHtml: string) => {
    const frame = exportFrameRef.current;
    if (!frame) throw new Error('Export frame is not ready');
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Preview render timeout')), 8000);
      frame.onload = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      frame.srcdoc = pageHtml;
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

  const applyExportFrame = (frame: number, fps: number, pageIndex: number, pageCount: number) => {
    const time = frame / fps;
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
    }) | null;
    if (!win) return;

    win.__SEEHTML_EXPORT_FRAME__ = frame;
    win.__SEEHTML_EXPORT_FPS__ = fps;
    win.__SEEHTML_EXPORT_TIME__ = time;
    win.__SEEHTML_EXPORT_PAGE__ = pageIndex;
    win.__SEEHTML_EXPORT_PAGE_COUNT__ = pageCount;
    win.dispatchEvent(new CustomEvent('seehtml:export-frame', {
      detail: { frame, fps, time, pageIndex, pageCount },
    }));
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onSlideChange(Math.max(0, safeSlide - 1))}
            disabled={safeSlide === 0}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-0.5 text-xs hover:bg-[var(--color-border)] disabled:opacity-30"
          >‹</button>
          <span className="text-xs text-[var(--color-text-secondary)]">
            {t('export.page')} {safeSlide + 1} / {Math.max(slides.length, 1)}
          </span>
          <button
            onClick={() => onSlideChange(Math.min(slides.length - 1, safeSlide + 1))}
            disabled={safeSlide >= slides.length - 1}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-0.5 text-xs hover:bg-[var(--color-border)] disabled:opacity-30"
          >›</button>
        </div>
        <span className="min-w-4 flex-1" />
        <ToolButton onClick={handleCapture} disabled={capturing || Boolean(exporting)} label={capturing ? t('export.rendering') : t('export.png')} />
        <ToolButton onClick={() => exportDocument('pptx')} disabled={Boolean(exporting)} label={exporting === 'pptx' ? t('export.exporting') : t('export.pptx')} />
        <ToolButton onClick={() => exportDocument('markdown')} disabled={Boolean(exporting)} label={exporting === 'markdown' ? t('export.exporting') : t('export.markdown')} />
        <ToolButton primary onClick={exportAnimatedMp4} disabled={Boolean(exporting)} label={exporting === 'mp4' ? t('export.encodingMp4') : t('export.video')} />
        {exportStatus && (
          <span className="w-full truncate text-[10px] text-[var(--color-text-secondary)]">{exportStatus}</span>
        )}
      </div>

      <iframe
        ref={exportFrameRef}
        title="Export Renderer"
        sandbox="allow-scripts allow-same-origin"
        className="pointer-events-none fixed -left-[10000px] top-0 h-[1080px] w-[1920px] border-0 opacity-0"
      />

      <div className="min-h-0 flex-1 overflow-hidden bg-white">
        <iframe
          src={useWholeProjectUrl ? sourceUrl : undefined}
          srcDoc={useWholeProjectUrl ? undefined : currentContent}
          className="h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin"
          title="HTML Preview"
        />
      </div>

      {slides.length > 1 && (
        <div className="flex gap-1 overflow-x-auto border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-2">
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
  onClick,
  disabled,
  primary,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors disabled:opacity-45 ${
        primary
          ? 'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]'
          : 'border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] hover:bg-[var(--color-border)]'
      }`}
    >
      {label}
    </button>
  );
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}
