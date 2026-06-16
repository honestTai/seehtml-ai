import { useChatStore } from '../../stores/chatStore';
import { useI18n } from '../../lib/i18n';

export function StatusBar() {
  const { t } = useI18n();
  const isProcessing = useChatStore((s) => s.isProcessing);
  const msgCount = useChatStore((s) => s.messages.length);
  const htmlDoc = useChatStore((s) => s.htmlDocument);

  return (
    <div className='mx-3 mb-3 flex h-7 flex-shrink-0 items-center gap-3 overflow-hidden rounded-full border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 text-[11px] text-[var(--color-text-secondary)] shadow-sm'>
      <span>SeeHTML AI · DeepSeek V4</span>
      <span className='w-px h-3 bg-[var(--color-border)]' />
      <span>{isProcessing ? `⚡ ${t('status.processing')}` : `🟢 ${t('status.ready')}`}</span>
      <span className='w-px h-3 bg-[var(--color-border)]' />
      <span>{msgCount} {t('chat.messages')}</span>
      {htmlDoc && <><span className='w-px h-3 bg-[var(--color-border)]' /><span>📄 {t('status.htmlLoaded')}</span></>}
      <span className='flex-1' />
      <span className='opacity-40 max-lg:hidden'>Ctrl+K Palette · Ctrl+B Sidebar</span>
    </div>
  );
}
