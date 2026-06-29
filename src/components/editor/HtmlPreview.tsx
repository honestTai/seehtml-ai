import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, FileDown, ImageDown, MousePointer2, Sparkles, Video, X } from 'lucide-react';
import { toPng } from 'html-to-image';
import { useI18n } from '../../lib/i18n';
import { splitHtmlPages } from '../../lib/htmlPages';
import { applyElementPatch, buildElementEditPrompt, type ElementStylePatch, type SelectedElementContext } from '../../lib/htmlElementPatch';
import { notifyProjectFilesChanged, projectExportDir, projectExportPath, projectFramesDir } from '../../lib/projectPaths';
import { usePreviewStore } from '../../stores/previewStore';
import { useUIStore } from '../../stores/uiStore';
import { useChatStore } from '../../stores/chatStore';
import {
  DEFAULT_MP4_EXPORT_PROFILE_ID,
  MP4_EXPORT_PROFILES,
  getMp4ExportProfile,
  mp4ProfileFileName,
  mp4ProfileOptionLabel,
  mp4ProfileShortLabel,
  type Mp4ExportProfileId,
} from '../../lib/mp4ExportProfiles';

interface Props {
  htmlContent: string;
  sections?: { id: string; heading?: string; content: string }[];
  currentSlide: number;
  onSlideChange: (index: number) => void;
  onCapture: (dataUrl: string, index: number) => void;
  onHtmlChange?: (html: string) => Promise<void> | void;
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
  onHtmlChange,
  baseHref,
  backgroundOnly = false,
  processRenderRequests = true,
}: Props) {
  const { t, lang } = useI18n();
  const exportFrameRef = useRef<HTMLIFrameElement>(null);
  const previewFrameRef = useRef<HTMLIFrameElement>(null);
  const handledRenderRequests = useRef<Set<string>>(new Set());
  const cleanupInspectRef = useRef<(() => void) | null>(null);
  const renderRequest = usePreviewStore((s) => s.renderRequest);
  const clearRenderRequest = usePreviewStore((s) => s.clearRenderRequest);
  const setRenderStatus = usePreviewStore((s) => s.setRenderStatus);
  const projectPath = useUIStore((s) => s.projectPath);
  const [capturing, setCapturing] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState('');
  const [selectedMp4ProfileId, setSelectedMp4ProfileId] = useState<Mp4ExportProfileId>(DEFAULT_MP4_EXPORT_PROFILE_ID);
  const [inspectMode, setInspectMode] = useState(false);
  const [selectedElement, setSelectedElement] = useState<SelectedElementContext | null>(null);
  const [draftText, setDraftText] = useState('');
  const [draftColor, setDraftColor] = useState('');
  const [draftBackground, setDraftBackground] = useState('');
  const [draftFontSize, setDraftFontSize] = useState('');
  const [draftPadding, setDraftPadding] = useState('');
  const [draftMarginTop, setDraftMarginTop] = useState('');
  const [draftRadius, setDraftRadius] = useState('');
  const [draftPosition, setDraftPosition] = useState('');
  const [draftLeft, setDraftLeft] = useState('');
  const [draftTop, setDraftTop] = useState('');
  const [draftWidth, setDraftWidth] = useState('');
  const [draftHeight, setDraftHeight] = useState('');
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');

  const draftValuesRef = useRef({
    text: '',
    color: '',
    background: '',
    fontSize: '',
    padding: '',
    marginTop: '',
    radius: '',
    position: '',
    left: '',
    top: '',
    width: '',
    height: '',
  });

  useEffect(() => {
    draftValuesRef.current = {
      text: draftText,
      color: draftColor,
      background: draftBackground,
      fontSize: draftFontSize,
      padding: draftPadding,
      marginTop: draftMarginTop,
      radius: draftRadius,
      position: draftPosition,
      left: draftLeft,
      top: draftTop,
      width: draftWidth,
      height: draftHeight,
    };
  }, [draftText, draftColor, draftBackground, draftFontSize, draftPadding, draftMarginTop, draftRadius, draftPosition, draftLeft, draftTop, draftWidth, draftHeight]);

  const renderWholeDocument = useMemo(() => hasRealTimeline(htmlContent), [htmlContent]);
  const preparedHtml = useMemo(() => withBaseHref(htmlContent, baseHref), [baseHref, htmlContent]);
  const slides = useMemo(() => {
    if (renderWholeDocument) return [{ id: 'document', title: 'HTML', html: preparedHtml }];
    if (sections && sections.length > 0) {
      return sections.map((section) => ({ id: section.id, title: section.heading || section.id, html: section.content }));
    }
    return splitHtmlPages(htmlContent, { baseHref });
  }, [baseHref, htmlContent, preparedHtml, renderWholeDocument, sections]);
  const safeSlide = Math.min(currentSlide, Math.max(slides.length - 1, 0));
  const hasMultiplePages = !renderWholeDocument && slides.length > 1;
  const currentContent = renderWholeDocument || slides.length <= 1
    ? preparedHtml
    : slides[safeSlide]?.html || preparedHtml;
  const visibleThumbnailIndexes = useMemo(
    () => visibleSlideIndexes(slides.length, safeSlide),
    [safeSlide, slides.length],
  );
  const previewShellClass = previewDevice === 'desktop'
    ? 'w-full'
    : previewDevice === 'tablet'
    ? 'mx-auto w-full max-w-[820px]'
    : 'mx-auto w-full max-w-[390px]';

  useEffect(() => {
    if (currentSlide !== safeSlide) onSlideChange(safeSlide);
  }, [currentSlide, safeSlide, onSlideChange]);

  const publishExportStatus = useCallback((
    message: string,
    state: 'running' | 'done' | 'error' = 'running',
    outputPath?: string,
  ) => {
    setExportStatus(message);
    setRenderStatus({ state, message, outputPath });
  }, [setRenderStatus]);

  const handleCapture = async () => {
    if (capturing || exporting) return;
    if (!projectPath) {
      publishExportStatus(t('project.required'), 'error');
      return;
    }
    setCapturing(true);
    publishExportStatus(t('export.renderingPage'));
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
      publishExportStatus(`${t('chat.exported')} ${path}`, 'done', path);
    } catch (e) {
      publishExportStatus(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setCapturing(false);
    }
  };

  const exportDocument = async (format: 'pptx' | 'markdown') => {
    if (exporting) return;
    if (!projectPath) {
      publishExportStatus(t('project.required'), 'error');
      return;
    }
    setExporting(format);
    publishExportStatus(format === 'pptx' ? t('export.pptBackgroundRunning') : t('export.markdownBackgroundRunning'));
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
      const output = result?.output_path || outputPath;
      publishExportStatus(`${t('chat.exported')} ${output}`.trim(), 'done', output);
    } catch (e) {
      publishExportStatus(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setExporting(null);
    }
  };

  const exportAnimatedMp4 = async (profileId: Mp4ExportProfileId = selectedMp4ProfileId) => {
    if (exporting) return;
    if (!projectPath) {
      publishExportStatus(t('project.required'), 'error');
      return;
    }
    const exportPages = buildMp4ExportPages(htmlContent, slides, baseHref);
    const profile = getMp4ExportProfile(profileId);
    const fps = profile.fps;
    let frameIndex = 0;

    setSelectedMp4ProfileId(profile.id);
    setExporting('mp4');
    publishExportStatus(`${t('export.mp4BackgroundRunning')} · ${mp4ProfileOptionLabel(profile, lang)}`);
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
        outputPath: projectExportPath(projectPath, mp4ProfileFileName(profile)),
      });
      notifyProjectFilesChanged(projectPath);
      publishExportStatus(`${t('chat.exported')} ${outputPath}`, 'done', outputPath);
      await openExportedMp4(outputPath);
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
    void exportAnimatedMp4(renderRequest.profileId);
  }, [renderRequest, exporting, capturing, processRenderRequests, htmlContent]);

  const openExportedMp4 = async (path: string) => {
    const preview = usePreviewStore.getState();
    const doc = await preview.openFile(path, fileName(path));
    if (!doc) return;
    const ui = useUIStore.getState();
    ui.setWorkspaceSelectionPath(path);
    ui.setWorkspaceMode('mp4');
  };

  const handleInspectFrameLoad = useCallback(() => {
    cleanupInspectRef.current?.();
    cleanupInspectRef.current = null;
    if (!inspectMode) return;
    const frame = previewFrameRef.current;
    const doc = frame?.contentDocument;
    if (!doc) return;
    cleanupInspectRef.current = installInspectHandlers(
      doc,
      (element) => {
        setSelectedElement(element);
        setDraftText(element.text || '');
        setDraftColor(toHexColor(element.style?.color || '') || '');
        setDraftBackground(toHexColor(element.style?.backgroundColor || '') || '');
        setDraftFontSize(stripPx(element.style?.fontSize || ''));
        setDraftPadding(element.style?.padding || '');
        setDraftMarginTop(element.style?.marginTop || '');
        setDraftRadius(element.style?.borderRadius || '');
        setDraftPosition(element.style?.position || '');
        setDraftLeft(stripPx(element.style?.left || ''));
        setDraftTop(stripPx(element.style?.top || ''));
        setDraftWidth(stripPx(element.style?.width || ''));
        setDraftHeight(stripPx(element.style?.height || ''));
      },
      (dragStyles) => {
        if (dragStyles.position !== undefined) setDraftPosition(dragStyles.position);
        if (dragStyles.left !== undefined) setDraftLeft(stripPx(dragStyles.left));
        if (dragStyles.top !== undefined) setDraftTop(stripPx(dragStyles.top));
        if (dragStyles.width !== undefined) setDraftWidth(stripPx(dragStyles.width));
        if (dragStyles.height !== undefined) setDraftHeight(stripPx(dragStyles.height));
      },
      async (finalStyles) => {
        if (!selectedElement || !onHtmlChange) return;
        const currentDrafts = draftValuesRef.current;
        const style = buildDraftStyle({
          color: currentDrafts.color,
          backgroundColor: currentDrafts.background,
          fontSize: currentDrafts.fontSize,
          padding: currentDrafts.padding,
          marginTop: currentDrafts.marginTop,
          borderRadius: currentDrafts.radius,
          position: finalStyles.position ?? currentDrafts.position,
          left: finalStyles.left !== undefined ? stripPx(finalStyles.left) : currentDrafts.left,
          top: finalStyles.top !== undefined ? stripPx(finalStyles.top) : currentDrafts.top,
          width: finalStyles.width !== undefined ? stripPx(finalStyles.width) : currentDrafts.width,
          height: finalStyles.height !== undefined ? stripPx(finalStyles.height) : currentDrafts.height,
        });

        // Sync local React states
        if (finalStyles.position !== undefined) setDraftPosition(finalStyles.position);
        if (finalStyles.left !== undefined) setDraftLeft(stripPx(finalStyles.left));
        if (finalStyles.top !== undefined) setDraftTop(stripPx(finalStyles.top));
        if (finalStyles.width !== undefined) setDraftWidth(stripPx(finalStyles.width));
        if (finalStyles.height !== undefined) setDraftHeight(stripPx(finalStyles.height));

        const result = applyElementPatch(htmlContent, {
          path: selectedElement.path,
          text: currentDrafts.text,
          style,
        });
        if (result.ok) {
          await onHtmlChange(result.html);
          publishExportStatus(t('inspect.applied'), 'done');
        }
      }
    );
  }, [inspectMode, selectedElement, onHtmlChange, htmlContent, t]);

  useEffect(() => {
    handleInspectFrameLoad();
    return () => {
      cleanupInspectRef.current?.();
      cleanupInspectRef.current = null;
    };
  }, [handleInspectFrameLoad, currentContent]);

  const applyInspectorPatch = async () => {
    if (!selectedElement || !onHtmlChange) return;
    const style = buildDraftStyle({
      color: draftColor,
      backgroundColor: draftBackground,
      fontSize: draftFontSize,
      padding: draftPadding,
      marginTop: draftMarginTop,
      borderRadius: draftRadius,
    });
    const result = applyElementPatch(htmlContent, {
      path: selectedElement.path,
      text: draftText,
      style,
    });
    if (!result.ok) {
      publishExportStatus(result.reason || t('inspect.targetMissing'), 'error');
      return;
    }
    await onHtmlChange(result.html);
    publishExportStatus(t('inspect.applied'), 'done');
  };

  const sendSelectedElementToAgent = () => {
    if (!selectedElement) return;
    const prompt = buildElementEditPrompt(selectedElement, t('inspect.agentPrompt'));
    useChatStore.getState().setInputValue(prompt);
    window.dispatchEvent(new CustomEvent('seehtml:focus-chat-input'));
  };

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
    <div className="relative h-full min-h-0 overflow-hidden bg-[#f8fbff] px-4 pb-4 pt-16">
      <iframe
        ref={exportFrameRef}
        title="Export Renderer"
        sandbox="allow-scripts allow-same-origin"
        className="pointer-events-none fixed -left-[10000px] top-0 h-[1080px] w-[1920px] border-0 opacity-0"
      />

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(15,110,255,0.05),transparent_34%)]" />

      <div className={`relative h-full overflow-hidden rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-white shadow-[0_18px_42px_rgba(15,23,42,0.08)] ${previewShellClass}`}>
        <iframe
          ref={previewFrameRef}
          srcDoc={currentContent}
          className={`h-full w-full border-0 bg-white ${inspectMode ? 'cursor-crosshair' : ''}`}
          sandbox="allow-scripts allow-same-origin"
          title="HTML Preview"
          onLoad={handleInspectFrameLoad}
        />
      </div>

      <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-4">
        <div className="flex h-10 items-center overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-border)] bg-white shadow-sm">
          <button
            type="button"
            onClick={() => onSlideChange(Math.max(0, safeSlide - 1))}
            disabled={!hasMultiplePages || safeSlide === 0}
            className="flex h-full w-11 items-center justify-center border-r border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] disabled:cursor-default disabled:opacity-35"
            title="Back"
            aria-label="Back"
          ><ChevronLeft size={16} /></button>
          <button
            type="button"
            onClick={() => setPreviewDevice('desktop')}
            aria-pressed={previewDevice === 'desktop'}
            className={`flex h-full w-11 items-center justify-center border-r border-[var(--color-border)] ${previewDevice === 'desktop' ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]'}`}
            title="Desktop"
            aria-label="Desktop"
          ><span className="h-4 w-5 rounded-sm border border-current" /></button>
          <button
            type="button"
            onClick={() => setPreviewDevice('tablet')}
            aria-pressed={previewDevice === 'tablet'}
            className={`flex h-full w-11 items-center justify-center border-r border-[var(--color-border)] ${previewDevice === 'tablet' ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]'}`}
            title="Tablet"
            aria-label="Tablet"
          ><span className="h-5 w-4 rounded-sm border border-current" /></button>
          <button
            type="button"
            onClick={() => setPreviewDevice('mobile')}
            aria-pressed={previewDevice === 'mobile'}
            className={`flex h-full w-11 items-center justify-center ${previewDevice === 'mobile' ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]'}`}
            title="Mobile"
            aria-label="Mobile"
          ><span className="h-5 w-3 rounded-sm border border-current" /></button>
        </div>
        <div className="flex h-10 items-center gap-1 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-white p-1 shadow-sm">
        {hasMultiplePages && (
          <div className="mr-1 flex items-center gap-0.5 border-r border-[var(--color-border)] pr-1">
          <button
            type="button"
            onClick={() => onSlideChange(Math.max(0, safeSlide - 1))}
            disabled={safeSlide === 0}
              className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-accent)] disabled:opacity-30"
              title="Previous page"
              aria-label="Previous page"
          ><ChevronLeft size={15} /></button>
            <span className="px-1.5 text-[11px] font-medium text-[var(--color-text-secondary)]">
            {t('export.page')} {safeSlide + 1} / {Math.max(slides.length, 1)}
          </span>
          <button
            type="button"
            onClick={() => onSlideChange(Math.min(slides.length - 1, safeSlide + 1))}
            disabled={safeSlide >= slides.length - 1}
              className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-accent)] disabled:opacity-30"
              title="Next page"
              aria-label="Next page"
          ><ChevronRight size={15} /></button>
        </div>
        )}
        <ToolButton
          icon={<MousePointer2 size={14} />}
          onClick={() => {
            setInspectMode((value) => !value);
            if (inspectMode) setSelectedElement(null);
          }}
          disabled={Boolean(exporting)}
          label={inspectMode ? t('inspect.exit') : t('inspect.enter')}
          shortLabel={t('inspect.short')}
          active={inspectMode}
        />
        <ToolButton icon={<ImageDown size={14} />} onClick={handleCapture} disabled={capturing || Boolean(exporting)} label={capturing ? t('export.rendering') : t('export.png')} shortLabel="PNG" />
        <ToolButton icon={<FileDown size={14} />} onClick={() => exportDocument('pptx')} disabled={Boolean(exporting)} label={exporting === 'pptx' ? t('export.exporting') : t('export.pptx')} shortLabel="PPT" />
        <Mp4ProfileSelector
          value={selectedMp4ProfileId}
          disabled={Boolean(exporting)}
          onChange={setSelectedMp4ProfileId}
          lang={lang}
        />
        <ToolButton
          icon={<Video size={14} />}
          primary
          onClick={() => exportAnimatedMp4()}
          disabled={Boolean(exporting)}
          label={exporting === 'mp4' ? t('export.encodingMp4') : `${t('export.video')} · ${mp4ProfileOptionLabel(getMp4ExportProfile(selectedMp4ProfileId), lang)}`}
          shortLabel="MP4"
        />
        </div>
      </div>

      {exportStatus && (
        <div className={`absolute inset-x-6 ${hasMultiplePages ? 'bottom-[96px]' : 'bottom-6'} truncate rounded-[var(--radius-control)] border border-[var(--color-border)] bg-white/96 px-3 py-2 text-[11px] text-[var(--color-text-secondary)] shadow-sm backdrop-blur`}>
          {exportStatus}
      </div>
      )}

      {inspectMode && (
        <InspectorPanel
          element={selectedElement}
          draftText={draftText}
          draftColor={draftColor}
          draftBackground={draftBackground}
          draftFontSize={draftFontSize}
          draftPadding={draftPadding}
          draftMarginTop={draftMarginTop}
          draftRadius={draftRadius}
          draftPosition={draftPosition}
          draftLeft={draftLeft}
          draftTop={draftTop}
          draftWidth={draftWidth}
          draftHeight={draftHeight}
          canApply={Boolean(selectedElement && onHtmlChange)}
          onDraftTextChange={setDraftText}
          onDraftColorChange={setDraftColor}
          onDraftBackgroundChange={setDraftBackground}
          onDraftFontSizeChange={setDraftFontSize}
          onDraftPaddingChange={setDraftPadding}
          onDraftMarginTopChange={setDraftMarginTop}
          onDraftRadiusChange={setDraftRadius}
          onDraftPositionChange={setDraftPosition}
          onDraftLeftChange={setDraftLeft}
          onDraftTopChange={setDraftTop}
          onDraftWidthChange={setDraftWidth}
          onDraftHeightChange={setDraftHeight}
          onApply={() => void applyInspectorPatch()}
          onSendToAgent={sendSelectedElementToAgent}
          onClose={() => {
            setInspectMode(false);
            setSelectedElement(null);
          }}
        />
      )}

      {hasMultiplePages && (
        <div className="absolute inset-x-6 bottom-6 flex gap-1 overflow-x-auto rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-white/94 px-2 py-2 shadow-sm backdrop-blur">
          {visibleThumbnailIndexes.map((i) => {
            const slide = slides[i];
            return (
            <button
              key={slide.id}
              type="button"
              onClick={() => onSlideChange(i)}
              aria-label={`${t('export.page')} ${i + 1}: ${slide.title}`}
              aria-current={i === safeSlide ? 'page' : undefined}
              className={`h-14 w-24 flex-shrink-0 overflow-hidden rounded-[var(--radius-control)] border bg-white transition-colors ${
                i === safeSlide ? 'border-[var(--color-accent)] shadow-[0_0_0_2px_var(--color-accent-soft)]' : 'border-[var(--color-border)] hover:border-[var(--color-text-secondary)]'
              }`}
              title={slide.title}
            >
              <iframe
                srcDoc={slide.html}
                className="pointer-events-none h-full w-full border-0"
                sandbox="allow-scripts allow-same-origin"
                title={`Slide ${i + 1}`}
                loading="lazy"
                style={{ transform: 'scale(0.25)', transformOrigin: '0 0', width: '384px', height: '216px' }}
              />
            </button>
          );
          })}
        </div>
      )}
    </div>
  );
}

function Mp4ProfileSelector({
  value,
  disabled,
  onChange,
  lang,
}: {
  value: Mp4ExportProfileId;
  disabled?: boolean;
  onChange: (value: Mp4ExportProfileId) => void;
  lang: 'zh' | 'en';
}) {
  return (
    <div className="mx-0.5 flex h-7 items-center rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-0.5">
      {MP4_EXPORT_PROFILES.map((profile) => {
        const active = profile.id === value;
        return (
          <button
            key={profile.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(profile.id)}
            title={mp4ProfileOptionLabel(profile, lang)}
            aria-label={mp4ProfileOptionLabel(profile, lang)}
            aria-pressed={active}
            className={`flex h-6 w-7 items-center justify-center rounded-[calc(var(--radius-control)-2px)] text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
              active
                ? 'bg-white text-[var(--color-accent)] shadow-sm'
                : 'text-[var(--color-text-secondary)] hover:bg-white hover:text-[var(--color-text-primary)]'
            }`}
          >
            {mp4ProfileShortLabel(profile, lang)}
          </button>
        );
      })}
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
  active,
}: {
  label: string;
  shortLabel: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-[11px] font-medium transition-colors disabled:opacity-45 ${
        primary || active
          ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:bg-[#dcebff]'
          : 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]'
      }`}
    >
      {icon}
      <span>{shortLabel}</span>
    </button>
  );
}

function InspectorPanel({
  element,
  draftText,
  draftColor,
  draftBackground,
  draftFontSize,
  draftPadding,
  draftMarginTop,
  draftRadius,
  draftPosition,
  draftLeft,
  draftTop,
  draftWidth,
  draftHeight,
  canApply,
  onDraftTextChange,
  onDraftColorChange,
  onDraftBackgroundChange,
  onDraftFontSizeChange,
  onDraftPaddingChange,
  onDraftMarginTopChange,
  onDraftRadiusChange,
  onDraftPositionChange,
  onDraftLeftChange,
  onDraftTopChange,
  onDraftWidthChange,
  onDraftHeightChange,
  onApply,
  onSendToAgent,
  onClose,
}: {
  element: SelectedElementContext | null;
  draftText: string;
  draftColor: string;
  draftBackground: string;
  draftFontSize: string;
  draftPadding: string;
  draftMarginTop: string;
  draftRadius: string;
  draftPosition: string;
  draftLeft: string;
  draftTop: string;
  draftWidth: string;
  draftHeight: string;
  canApply: boolean;
  onDraftTextChange: (value: string) => void;
  onDraftColorChange: (value: string) => void;
  onDraftBackgroundChange: (value: string) => void;
  onDraftFontSizeChange: (value: string) => void;
  onDraftPaddingChange: (value: string) => void;
  onDraftMarginTopChange: (value: string) => void;
  onDraftRadiusChange: (value: string) => void;
  onDraftPositionChange: (value: string) => void;
  onDraftLeftChange: (value: string) => void;
  onDraftTopChange: (value: string) => void;
  onDraftWidthChange: (value: string) => void;
  onDraftHeightChange: (value: string) => void;
  onApply: () => void;
  onSendToAgent: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <aside className="absolute bottom-6 right-6 top-24 flex w-[318px] flex-col overflow-hidden rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-white/96 shadow-[0_18px_42px_rgba(15,23,42,0.14)] backdrop-blur">
      <div className="flex h-12 items-center gap-2 border-b border-[var(--color-border)] bg-white px-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <MousePointer2 size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-[var(--color-text-primary)]">{t('inspect.title')}</div>
          <div className="truncate text-[10px] text-[var(--color-text-secondary)]">
            {element ? `${element.tagName}${element.pageLabel ? ` · ${element.pageLabel}` : ''}` : t('inspect.empty')}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          title={t('settings.close')}
          aria-label={t('settings.close')}
          className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-accent)]"
        >
          <X size={14} />
        </button>
      </div>

      {element ? (
        <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
          <FieldLabel label={t('inspect.text')} />
          <textarea
            value={draftText}
            onChange={(event) => onDraftTextChange(event.target.value)}
            className="min-h-24 w-full resize-y rounded-[var(--radius-control)] border border-[var(--color-border)] bg-white px-2 py-2 text-xs leading-5 text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
          />

          <div className="mt-3 grid grid-cols-2 gap-2">
            <ColorField label={t('inspect.color')} value={draftColor} onChange={onDraftColorChange} />
            <ColorField label={t('inspect.background')} value={draftBackground} onChange={onDraftBackgroundChange} />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <TextField label={t('inspect.fontSize')} value={draftFontSize} suffix="px" onChange={onDraftFontSizeChange} />
            <TextField label={t('inspect.radius')} value={draftRadius} onChange={onDraftRadiusChange} />
            <TextField label={t('inspect.padding')} value={draftPadding} onChange={onDraftPaddingChange} />
            <TextField label={t('inspect.marginTop')} value={draftMarginTop} onChange={onDraftMarginTopChange} />
            <TextField label="Position" value={draftPosition} onChange={onDraftPositionChange} />
            <TextField label="Left" value={draftLeft} suffix="px" onChange={onDraftLeftChange} />
            <TextField label="Top" value={draftTop} suffix="px" onChange={onDraftTopChange} />
            <TextField label="Width" value={draftWidth} suffix="px" onChange={onDraftWidthChange} />
            <TextField label="Height" value={draftHeight} suffix="px" onChange={onDraftHeightChange} />
          </div>

          <div className="mt-3 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-white px-2.5 py-2 text-[10px] leading-4 text-[var(--color-text-secondary)]">
            <div className="font-medium text-[var(--color-text-primary)]">{t('inspect.path')}</div>
            <div className="mt-1 break-all font-mono">{element.path}</div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-xs leading-5 text-[var(--color-text-secondary)]">
          {t('inspect.emptyHint')}
        </div>
      )}

      <div className="flex gap-2 border-t border-[var(--color-border)] p-3">
        <button
          type="button"
          onClick={onSendToAgent}
          disabled={!element}
          className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border)] text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] disabled:opacity-40"
        >
          <Sparkles size={14} />
          {t('inspect.agent')}
        </button>
        <button
          type="button"
          onClick={onApply}
          disabled={!canApply}
          className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-accent)] text-xs font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
        >
          <Check size={14} />
          {t('inspect.apply')}
        </button>
      </div>
    </aside>
  );
}

function FieldLabel({ label }: { label: string }) {
  return <div className="mb-1 text-[10px] font-semibold uppercase tracking-normal text-[var(--color-text-secondary)]">{label}</div>;
}

function TextField({
  label,
  value,
  suffix,
  onChange,
}: {
  label: string;
  value: string;
  suffix?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <FieldLabel label={label} />
      <div className="flex h-8 items-center rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-xs text-[var(--color-text-primary)] outline-none"
        />
        {suffix && <span className="ml-1 text-[10px] text-[var(--color-text-secondary)]">{suffix}</span>}
      </div>
    </label>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const normalized = value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
  return (
    <label className="block">
      <FieldLabel label={label} />
      <div className="flex h-8 items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-1.5">
        <input
          type="color"
          value={normalized}
          onChange={(event) => onChange(event.target.value)}
          className="h-5 w-6 flex-shrink-0 cursor-pointer border-0 bg-transparent p-0"
        />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="#000000"
          className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-[var(--color-text-primary)] outline-none"
        />
      </div>
    </label>
  );
}

function installInspectHandlers(
  doc: Document,
  onSelect: (element: SelectedElementContext) => void,
  onDragUpdate: (styles: { position?: string; left?: string; top?: string; width?: string; height?: string }) => void,
  onDragEnd: (styles: { position?: string; left?: string; top?: string; width?: string; height?: string }) => void,
): () => void {
  const style = doc.createElement('style');
  style.id = '__seehtml_inspect_style__';
  style.textContent = `
    [data-seehtml-hover="true"] {
      outline: 2px dashed #3b82f6 !important;
      outline-offset: 2px !important;
      cursor: crosshair !important;
    }
    [data-seehtml-selected="true"] {
      outline: 2px solid #3b82f6 !important;
      outline-offset: 2px !important;
      box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.15) !important;
    }
  `;
  doc.head?.appendChild(style);

  let hovered: HTMLElement | null = null;
  let selected: HTMLElement | null = null;

  const clearHover = () => {
    if (hovered && hovered !== selected) hovered.removeAttribute('data-seehtml-hover');
    hovered = null;
  };

  const onMove = (event: MouseEvent) => {
    const next = inspectableTarget(event.target);

    // If we are hovering over the selected element, update cursor if near bottom-right corner
    if (selected && (event.target === selected || selected.contains(event.target as Node))) {
      const rect = selected.getBoundingClientRect();
      const isResizeZone = event.clientX >= rect.right - 15 && event.clientY >= rect.bottom - 15;
      selected.style.cursor = isResizeZone ? 'se-resize' : 'move';
    }

    if (next === hovered) return;
    clearHover();
    hovered = next;
    if (hovered && hovered !== selected) hovered.setAttribute('data-seehtml-hover', 'true');
  };

  const onLeave = () => clearHover();

  const onClick = (event: MouseEvent) => {
    const target = inspectableTarget(event.target);
    if (!target) return;

    // If it's already selected, don't re-select and block normal clicks
    if (selected === target) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    selected?.removeAttribute('data-seehtml-selected');
    if (hovered && hovered !== target) hovered.removeAttribute('data-seehtml-hover');
    selected = target;
    selected.setAttribute('data-seehtml-selected', 'true');
    onSelect(elementContext(target));
  };

  // Pointer drag/resize tracking
  const onPointerDown = (event: PointerEvent) => {
    const el = selected;
    if (!el) return;
    const target = event.target as HTMLElement;
    if (target !== el && !el.contains(target)) return;

    event.preventDefault();
    event.stopPropagation();

    const rect = el.getBoundingClientRect();
    const isResize = event.clientX >= rect.right - 15 && event.clientY >= rect.bottom - 15;

    const startX = event.clientX;
    const startY = event.clientY;

    const startWidth = rect.width;
    const startHeight = rect.height;

    // Get current left/top style
    const computedStyle = el.ownerDocument.defaultView?.getComputedStyle(el);
    const initialPosition = computedStyle?.position || 'static';
    const startLeft = parseFloat(el.style.left) || 0;
    const startTop = parseFloat(el.style.top) || 0;

    if (initialPosition === 'static' || !el.style.position) {
      el.style.position = 'relative';
    }

    const onPointerMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      if (isResize) {
        const nextWidth = Math.max(20, startWidth + dx);
        const nextHeight = Math.max(20, startHeight + dy);
        el.style.width = nextWidth + 'px';
        el.style.height = nextHeight + 'px';
        onDragUpdate({
          width: el.style.width,
          height: el.style.height,
        });
      } else {
        const nextLeft = startLeft + dx;
        const nextTop = startTop + dy;
        el.style.left = nextLeft + 'px';
        el.style.top = nextTop + 'px';
        onDragUpdate({
          position: el.style.position,
          left: el.style.left,
          top: el.style.top,
        });
      }
    };

    const onPointerUp = () => {
      doc.removeEventListener('pointermove', onPointerMove, true);
      doc.removeEventListener('pointerup', onPointerUp, true);

      // Trigger saving final styles
      if (isResize) {
        onDragEnd({
          width: el.style.width,
          height: el.style.height,
        });
      } else {
        onDragEnd({
          position: el.style.position,
          left: el.style.left,
          top: el.style.top,
        });
      }
    };

    doc.addEventListener('pointermove', onPointerMove, true);
    doc.addEventListener('pointerup', onPointerUp, true);
  };

  doc.addEventListener('mousemove', onMove, true);
  doc.addEventListener('mouseleave', onLeave, true);
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('pointerdown', onPointerDown, true);

  return () => {
    doc.removeEventListener('mousemove', onMove, true);
    doc.removeEventListener('mouseleave', onLeave, true);
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('pointerdown', onPointerDown, true);
    hovered?.removeAttribute('data-seehtml-hover');
    selected?.removeAttribute('data-seehtml-selected');
    style.remove();
  };
}

function inspectableTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  const element = target.closest<HTMLElement>('a,button,h1,h2,h3,h4,h5,h6,p,span,img,video,canvas,svg,li,section,article,div');
  if (!element) return null;
  const tag = element.tagName.toLowerCase();
  if (['html', 'body', 'script', 'style', 'link', 'meta'].includes(tag)) return null;
  return element;
}

function elementContext(element: HTMLElement): SelectedElementContext {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  const page = closestPageLabel(element);
  return {
    tagName: element.tagName.toLowerCase(),
    path: elementPath(element),
    text: readableText(element),
    pageLabel: page,
    id: element.id || undefined,
    className: typeof element.className === 'string' ? element.className : undefined,
    style: {
      color: style?.color || '',
      backgroundColor: style?.backgroundColor || '',
      fontSize: style?.fontSize || '',
      fontWeight: style?.fontWeight || '',
      lineHeight: style?.lineHeight || '',
      padding: style?.padding || '',
      marginTop: style?.marginTop || '',
      borderRadius: style?.borderRadius || '',
      position: style?.position || '',
      left: style?.left || '',
      top: style?.top || '',
      width: style?.width || '',
      height: style?.height || '',
    },
  };
}

function elementPath(element: HTMLElement): string {
  const parts: string[] = [];
  let cursor: Element | null = element;
  while (cursor && cursor instanceof HTMLElement) {
    const tag = cursor.tagName.toLowerCase();
    const parent: HTMLElement | null = cursor.parentElement;
    const siblings = parent
      ? Array.from(parent.children).filter((child: Element) => child.tagName.toLowerCase() === tag)
      : [cursor];
    const index = Math.max(1, siblings.indexOf(cursor) + 1);
    parts.unshift(`${tag}:nth-of-type(${index})`);
    if (tag === 'html') break;
    cursor = parent;
  }
  return parts.join(' > ');
}

function readableText(element: HTMLElement): string {
  const tag = element.tagName.toLowerCase();
  if (tag === 'img') return element.getAttribute('alt') || '';
  const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

function closestPageLabel(element: HTMLElement): string | undefined {
  const page = element.closest<HTMLElement>('[data-slide],[data-page],section.slide,section.page,.slide,.page,main > section,body > section');
  if (!page) return undefined;
  const explicit = page.getAttribute('data-title') || page.getAttribute('aria-label');
  if (explicit) return explicit;
  const pages = Array.from(page.parentElement?.children || []).filter((child) => child.tagName === page.tagName);
  const index = pages.indexOf(page) + 1;
  return index > 0 ? `Page ${index}` : undefined;
}

function buildDraftStyle(values: {
  color: string;
  backgroundColor: string;
  fontSize: string;
  padding: string;
  marginTop: string;
  borderRadius: string;
  position?: string;
  left?: string;
  top?: string;
  width?: string;
  height?: string;
}): ElementStylePatch {
  return {
    color: cleanStyleValue(values.color),
    backgroundColor: cleanStyleValue(values.backgroundColor),
    fontSize: normalizeCssLength(values.fontSize),
    padding: cleanStyleValue(values.padding),
    marginTop: cleanStyleValue(values.marginTop),
    borderRadius: normalizeCssLength(values.borderRadius),
    position: cleanStyleValue(values.position || ''),
    left: normalizeCssLength(values.left || ''),
    top: normalizeCssLength(values.top || ''),
    width: normalizeCssLength(values.width || ''),
    height: normalizeCssLength(values.height || ''),
  };
}

function cleanStyleValue(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeCssLength(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? `${trimmed}px` : trimmed;
}

function stripPx(value: string): string {
  const trimmed = value.trim();
  return trimmed.endsWith('px') ? trimmed.slice(0, -2) : trimmed;
}

function toHexColor(value: string): string | null {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  const rgb = trimmed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!rgb) return null;
  const [, r, g, b] = rgb;
  return `#${[r, g, b].map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`;
}

function visibleSlideIndexes(total: number, current: number, maxVisible = 12): number[] {
  if (total <= maxVisible) {
    return Array.from({ length: total }, (_, index) => index);
  }

  const indexes = new Set<number>([0, total - 1, current]);
  for (let offset = 1; indexes.size < maxVisible && offset < total; offset += 1) {
    const before = current - offset;
    const after = current + offset;
    if (before > 0) indexes.add(before);
    if (indexes.size >= maxVisible) break;
    if (after < total - 1) indexes.add(after);
  }

  return [...indexes].sort((a, b) => a - b);
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
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

