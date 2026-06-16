import { useRef, useEffect } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { MessageItem } from './MessageItem';
import { ChatInput } from './ChatInput';
import { useI18n } from '../../lib/i18n';

export function ChatPanel() {
  const { t } = useI18n();
  const messages = useChatStore((s) => s.messages);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  return (
    <aside className='w-96 flex-shrink-0 overflow-hidden rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-[var(--shadow-soft)] max-lg:h-[360px] max-lg:w-full'>
      <div className='flex h-full min-h-0 flex-col'>
      <div className='flex h-11 items-center border-b border-[var(--color-border)] px-4'>
        <span className='text-xs font-semibold text-[var(--color-text-primary)] tracking-wide'>💬 {t('chat.title')}</span>
        <span className='ml-auto rounded-full bg-[var(--color-bg-tertiary)] px-2 py-0.5 text-xs text-[var(--color-text-secondary)]'>{messages.length}</span>
      </div>
      <div className='min-h-0 flex-1 space-y-3 overflow-y-auto p-3'>
        {messages.map((msg) => (
          <MessageItem key={msg.id} message={msg} />
        ))}
        {isProcessing && (
          <div className='flex items-center gap-2 text-xs text-[var(--color-text-secondary)]'>
            <span className='animate-spin'>⚡</span> {t('chat.processing')}
          </div>
        )}
        <div ref={endRef} />
      </div>
      <ChatInput />
      </div>
    </aside>
  );
}
