import { useChatStore } from '../../stores/chatStore';
import { usePreviewStore } from '../../stores/previewStore';
import { useI18n } from '../../lib/i18n';

export function StatusBar() {
  const { t } = useI18n();
  const isProcessing = useChatStore((s) => s.isProcessing);
  const msgCount = useChatStore((s) => s.messages.length);
  const htmlDoc = useChatStore((s) => s.htmlDocument);
  const renderStatus = usePreviewStore((s) => s.renderStatus);
  const isRendering = renderStatus?.state === 'queued' || renderStatus?.state === 'running';
  const renderColor = renderStatus?.state === 'error'
    ? 'bg-[var(--color-danger)]'
    : renderStatus?.state === 'done'
    ? 'bg-[var(--color-success)]'
    : 'bg-[var(--color-warning)]';

  return (
    <div className='flex h-7 flex-shrink-0 items-center gap-3 overflow-hidden border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 text-[11px] text-[var(--color-text-secondary)]'>
      <span>SeeHTML AI · 4Router gpt-5.5</span>
      <span className='w-px h-3 bg-[var(--color-border)]' />
      <span className='inline-flex items-center gap-1.5'>
        <span className={`h-1.5 w-1.5 rounded-full ${isProcessing ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-success)]'}`} />
        {isProcessing ? t('status.processing') : t('status.ready')}
      </span>
      <span className='w-px h-3 bg-[var(--color-border)]' />
      <span>{msgCount} {t('chat.messages')}</span>
      {htmlDoc && <><span className='w-px h-3 bg-[var(--color-border)]' /><span>{t('status.htmlLoaded')}</span></>}
      {renderStatus && (
        <>
          <span className='h-3 w-px bg-[var(--color-border)]' />
          <span className='inline-flex min-w-0 items-center gap-1.5 truncate' title={renderStatus.outputPath || renderStatus.message}>
            <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${renderColor} ${isRendering ? 'animate-pulse' : ''}`} />
            <span className='truncate'>{renderStatus.message}</span>
          </span>
        </>
      )}
      <span className='flex-1' />
    </div>
  );
}
