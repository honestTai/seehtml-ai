import { useRef, useEffect, useState } from 'react';
import { toPng } from 'html-to-image';
import { useI18n } from '../../lib/i18n';

interface Props {
  htmlContent: string;
  sections?: { id: string; heading?: string; content: string }[];
  currentSlide: number;
  onSlideChange: (index: number) => void;
  onCapture: (dataUrl: string, index: number) => void;
}

export function HtmlPreview({ htmlContent, sections, currentSlide, onSlideChange, onCapture }: Props) {
  const { t } = useI18n();
  const slideRef = useRef<HTMLDivElement>(null);
  const [capturing, setCapturing] = useState(false);

  // Build slides from sections
  const slides = sections && sections.length > 0 
    ? sections 
    : [{ id: 'main', heading: 'Preview', content: htmlContent }];

  const currentContent = slides[currentSlide]?.content || htmlContent;

  const handleCapture = async () => {
    if (!slideRef.current || capturing) return;
    setCapturing(true);
    try {
      const dataUrl = await toPng(slideRef.current, {
        quality: 0.95,
        backgroundColor: '#ffffff',
        width: 1920,
        height: 1080,
        style: { transform: 'scale(1)', transformOrigin: 'top left' }
      });
      onCapture(dataUrl, currentSlide);
    } catch (e) {
      console.error('Capture failed:', e);
    } finally {
      setCapturing(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {/* Slide navigator */}
      {slides.length > 1 && (
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-3 py-2">
          <button
            onClick={() => onSlideChange(Math.max(0, currentSlide - 1))}
            disabled={currentSlide === 0}
            className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-0.5 text-xs hover:bg-[var(--color-border)] disabled:opacity-30"
          >◀</button>
          <span className="text-xs text-[var(--color-text-secondary)]">
            {currentSlide + 1} / {slides.length}
          </span>
          <button
            onClick={() => onSlideChange(Math.min(slides.length - 1, currentSlide + 1))}
            disabled={currentSlide === slides.length - 1}
            className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-0.5 text-xs hover:bg-[var(--color-border)] disabled:opacity-30"
          >▶</button>
          <span className="flex-1" />
          <button
            onClick={handleCapture}
            disabled={capturing}
            className="rounded-full bg-[var(--color-accent)] px-3 py-1 text-xs text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
          >{capturing ? '⏳' : '📸'} {t('editor.savePng')}</button>
        </div>
      )}

      {/* Preview area */}
      <div className="min-h-0 flex-1 overflow-hidden bg-white">
        <div
          ref={slideRef}
          className="h-full w-full overflow-hidden bg-white"
          style={{ transformOrigin: 'top left' }}
        >
          <iframe
            srcDoc={currentContent}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin"
            title="HTML Preview"
          />
        </div>
      </div>

      {/* Slide thumbnails */}
      {slides.length > 1 && (
        <div className="flex gap-1 overflow-x-auto border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2 py-2">
          {slides.map((slide, i) => (
            <button
              key={slide.id}
              onClick={() => onSlideChange(i)}
              className={`h-14 w-24 flex-shrink-0 overflow-hidden rounded-xl border-2 transition-colors ${
                i === currentSlide ? 'border-[var(--color-accent)]' : 'border-[var(--color-border)] hover:border-[var(--color-text-secondary)]'
              }`}
            >
              <iframe
                srcDoc={slide.content}
                className="w-full h-full border-0 pointer-events-none"
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
