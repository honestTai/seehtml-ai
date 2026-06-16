import ReactMarkdown from 'react-markdown';
import { useState, useCallback } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { usePreviewStore, type PreviewDocument } from '../../stores/previewStore';
import { HtmlPreview } from './HtmlPreview';
import { useI18n } from '../../lib/i18n';

export function EditorPanel() {
  const { t } = useI18n();
  const [currentSlide, setCurrentSlide] = useState(0);
  const [, setCapturedImages] = useState<string[]>([]);
  const htmlDoc = useChatStore((s) => s.htmlDocument);
  const previewDoc = usePreviewStore((s) => s.document);
  const isLoading = usePreviewStore((s) => s.isLoading);
  const error = usePreviewStore((s) => s.error);

  const activeDoc = previewDoc || (htmlDoc
    ? { name: t('preview.generatedHtml'), kind: 'html' as const, source: 'generated' as const, content: htmlDoc }
    : null);

  const handleCapture = useCallback((dataUrl: string, index: number) => {
    setCapturedImages((prev) => {
      const next = [...prev];
      next[index] = dataUrl;
      return next;
    });
  }, []);

  return (
    <section className='min-w-[520px] flex-[1.35] overflow-hidden bg-[var(--color-bg-secondary)] max-lg:min-w-0 max-lg:h-[520px] max-lg:flex-none'>
      <div className='flex h-full min-h-0 flex-col overflow-hidden'>
        <div className='flex h-12 flex-shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4'>
          <div className='min-w-0 flex-1'>
            <div className='truncate text-sm font-semibold text-[var(--color-text-primary)]'>
              {activeDoc?.name || t('preview.emptyTitle')}
            </div>
            <div className='truncate text-[11px] text-[var(--color-text-secondary)]'>
              {activeDoc?.path || t('preview.emptyHint')}
            </div>
          </div>
        </div>

        <div className='min-h-0 flex-1 bg-[var(--color-bg-primary)] p-2'>
          <div className='h-full overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]'>
            {isLoading ? (
              <PreviewState icon='...' title={t('preview.loading')} />
            ) : error ? (
              <PreviewState icon='!' title={t('preview.error')} body={error} />
            ) : activeDoc ? (
              <PreviewRenderer
                doc={activeDoc}
                currentSlide={currentSlide}
                onSlideChange={setCurrentSlide}
                onCapture={handleCapture}
              />
            ) : (
              <WelcomeScreen />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function PreviewRenderer({
  doc,
  currentSlide,
  onSlideChange,
  onCapture,
}: {
  doc: PreviewDocument;
  currentSlide: number;
  onSlideChange: (index: number) => void;
  onCapture: (dataUrl: string, index: number) => void;
}) {
  const { t } = useI18n();

  if (doc.kind === 'html') {
    return (
      <HtmlPreview
        htmlContent={doc.content || ''}
        currentSlide={currentSlide}
        onSlideChange={onSlideChange}
        onCapture={onCapture}
        sourceUrl={doc.source === 'file' ? doc.url : undefined}
        baseHref={doc.source === 'file' ? baseHref(doc.url) : undefined}
      />
    );
  }

  if (doc.kind === 'video') {
    return (
      <div className='flex h-full items-center justify-center bg-black'>
        <video
          src={doc.url}
          controls
          className='h-full w-full rounded-2xl object-contain'
        />
      </div>
    );
  }

  if (doc.kind === 'pdf') {
    return (
      <iframe
        src={doc.url}
        className='h-full w-full border-0 bg-white'
        title={doc.name}
      />
    );
  }

  if (doc.kind === 'markdown') {
    return (
      <div className='h-full overflow-auto bg-white px-8 py-7 text-[#172033]'>
        <article className='mx-auto max-w-4xl text-sm leading-7'>
          <ReactMarkdown
            components={{
              h1: ({ children }) => <h1 className='mb-5 text-3xl font-bold leading-tight'>{children}</h1>,
              h2: ({ children }) => <h2 className='mb-3 mt-7 text-2xl font-semibold'>{children}</h2>,
              h3: ({ children }) => <h3 className='mb-2 mt-5 text-lg font-semibold'>{children}</h3>,
              p: ({ children }) => <p className='mb-4'>{children}</p>,
              ul: ({ children }) => <ul className='mb-4 list-disc pl-6'>{children}</ul>,
              ol: ({ children }) => <ol className='mb-4 list-decimal pl-6'>{children}</ol>,
              code: ({ children }) => <code className='rounded bg-[#eef3f9] px-1.5 py-0.5 font-mono text-xs'>{children}</code>,
              pre: ({ children }) => <pre className='mb-4 overflow-auto rounded-xl bg-[#101828] p-4 text-xs text-white'>{children}</pre>,
              blockquote: ({ children }) => <blockquote className='mb-4 border-l-4 border-[#4f6bed] bg-[#f3f6fb] px-4 py-2 text-[#4b5563]'>{children}</blockquote>,
            }}
          >
            {doc.content || ''}
          </ReactMarkdown>
        </article>
      </div>
    );
  }

  if (doc.kind === 'image') {
    return (
      <div className='flex h-full items-center justify-center bg-[#101828] p-4'>
        <img src={doc.url} alt={doc.name} className='max-h-full max-w-full rounded-xl object-contain shadow-2xl' />
      </div>
    );
  }

  return <PreviewState icon='?' title={t('preview.unsupported')} />;
}

function baseHref(url?: string): string | undefined {
  if (!url) return undefined;
  const slash = url.lastIndexOf('/');
  return slash === -1 ? undefined : url.slice(0, slash + 1);
}

function PreviewState({ icon, title, body }: { icon: string; title: string; body?: string }) {
  return (
    <div className='flex h-full items-center justify-center p-8 text-center'>
      <div className='max-w-sm'>
        <div className='mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-bg-tertiary)] text-xl font-semibold text-[var(--color-text-secondary)]'>
          {icon}
        </div>
        <h2 className='text-base font-semibold text-[var(--color-text-primary)]'>{title}</h2>
        {body && <p className='mt-2 text-xs leading-5 text-[var(--color-text-secondary)]'>{body}</p>}
      </div>
    </div>
  );
}

function WelcomeScreen() {
  const { t } = useI18n();
  return (
    <div className='flex h-full items-center justify-center bg-[var(--color-bg-secondary)] p-8'>
      <div className='max-w-md text-center'>
        <div className='mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-[var(--color-bg-tertiary)] text-3xl'>
          #
        </div>
        <h2 className='mb-2 text-xl font-semibold text-[var(--color-text-primary)]'>SeeHTML AI</h2>
        <p className='text-sm leading-6 text-[var(--color-text-secondary)]'>
          {t('preview.welcome')}
        </p>
        <div className='mt-5 flex flex-wrap justify-center gap-2 text-xs text-[var(--color-text-secondary)]'>
          <span className='rounded-full bg-[var(--color-bg-tertiary)] px-3 py-1'>HTML</span>
          <span className='rounded-full bg-[var(--color-bg-tertiary)] px-3 py-1'>Video</span>
          <span className='rounded-full bg-[var(--color-bg-tertiary)] px-3 py-1'>PDF</span>
          <span className='rounded-full bg-[var(--color-bg-tertiary)] px-3 py-1'>Markdown</span>
          <span className='rounded-full bg-[var(--color-bg-tertiary)] px-3 py-1'>PNG</span>
        </div>
      </div>
    </div>
  );
}
