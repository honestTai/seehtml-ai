import { useRef, useEffect } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { MessageItem } from './MessageItem';
import { ChatInput } from './ChatInput';
import { useI18n } from '../../lib/i18n';
import type { ProcessingStep, QueuedRequest } from '../../types';

export function ChatPanel() {
  const { t } = useI18n();
  const messages = useChatStore((s) => s.messages);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const processingSteps = useChatStore((s) => s.processingSteps);
  const queuedRequests = useChatStore((s) => s.queuedRequests);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isProcessing, processingSteps, queuedRequests]);

  return (
    <section className='min-w-[420px] flex-[0.95] overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] max-lg:min-w-0 max-lg:h-[420px] max-lg:w-full max-lg:flex-none max-lg:border-b max-lg:border-r-0'>
      <div className='flex h-full min-h-0 flex-col'>
      <div className='flex h-12 items-center border-b border-[var(--color-border)] px-4'>
        <span className='text-xs font-semibold text-[var(--color-text-primary)] tracking-wide'>{t('sessions.current')}</span>
        <span className='ml-2 rounded-md bg-[var(--color-bg-tertiary)] px-2 py-0.5 text-[10px] text-[var(--color-text-secondary)]'>Agent</span>
        <span className='ml-auto rounded-full bg-[var(--color-bg-tertiary)] px-2 py-0.5 text-xs text-[var(--color-text-secondary)]'>{messages.length}</span>
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='mx-auto max-w-5xl space-y-3 px-4 py-3'>
          {messages.map((msg) => (
            <MessageItem key={msg.id} message={msg} />
          ))}
          {isProcessing && <ProcessingTrace steps={processingSteps} queue={queuedRequests} />}
          <div ref={endRef} />
        </div>
      </div>
      <ChatInput />
      </div>
    </section>
  );
}

function ProcessingTrace({ steps, queue }: { steps: ProcessingStep[]; queue: QueuedRequest[] }) {
  const { t } = useI18n();
  return (
    <div className='rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-tertiary)]/85 p-3 text-xs text-[var(--color-text-primary)] shadow-sm'>
      <div className='mb-2 flex items-center gap-2'>
        <span className='flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)]'>
          <span className='h-2 w-2 animate-pulse rounded-full bg-[var(--color-accent)]' />
        </span>
        <span className='font-semibold'>{t('chat.orchestrating')}</span>
        <span className='ml-auto text-[10px] text-[var(--color-text-secondary)]'>{t('chat.processing')}</span>
      </div>

      <div className='space-y-1.5'>
        {steps.map((step) => (
          <div key={step.id} className='flex gap-2 rounded-xl bg-[var(--color-bg-secondary)]/70 px-2.5 py-2'>
            <span className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[9px] ${
              step.status === 'done'
                ? 'bg-[var(--color-success)] text-white'
                : step.status === 'active'
                ? 'bg-[var(--color-accent)] text-white'
                : step.status === 'error'
                ? 'bg-[var(--color-danger)] text-white'
                : 'bg-[var(--color-border)] text-[var(--color-text-secondary)]'
            }`}>
              {step.status === 'done' ? '✓' : step.status === 'active' ? '•' : ''}
            </span>
            <div className='min-w-0 flex-1'>
              <div className='font-medium'>{step.title}</div>
              <div className='mt-0.5 line-clamp-2 text-[11px] leading-4 text-[var(--color-text-secondary)]'>{step.detail}</div>
            </div>
          </div>
        ))}
      </div>

      {queue.length > 0 && (
        <div className='mt-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/70 px-2.5 py-2'>
          <div className='mb-1 flex items-center text-[11px] font-medium text-[var(--color-text-secondary)]'>
            {t('chat.queue')} · {queue.length}
            <span className='ml-auto font-normal'>{t('chat.queueHint')}</span>
          </div>
          <div className='space-y-1'>
            {queue.slice(0, 3).map((item) => (
              <div key={item.id} className='truncate rounded-lg bg-[var(--color-bg-primary)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)]'>
                {item.kind === 'command' ? '/' : ''}{item.content || t('chat.imageDefault')}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
