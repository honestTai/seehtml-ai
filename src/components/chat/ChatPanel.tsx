import { useRef, useEffect } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { MessageItem } from './MessageItem';
import { ChatInput } from './ChatInput';
import { useI18n } from '../../lib/i18n';
import type { ProcessingStep, QueuedRequest } from '../../types';

export function ChatPanel() {
  const { t } = useI18n();
  const messages = useChatStore((s) => s.messages);
  const sessions = useChatStore((s) => s.sessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const processingSteps = useChatStore((s) => s.processingSteps);
  const queuedRequests = useChatStore((s) => s.queuedRequests);
  const endRef = useRef<HTMLDivElement>(null);
  const activeSession = sessions.find((session) => session.id === activeSessionId);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isProcessing, processingSteps, queuedRequests]);

  return (
    <section className='min-w-[390px] flex-[1] overflow-hidden bg-[var(--color-bg-primary)] max-lg:min-h-[280px] max-lg:min-w-0 max-lg:flex-[0.85] max-lg:border-b max-lg:border-[var(--color-border)]'>
      <div className='flex h-full min-h-0 flex-col'>
      <div className='flex h-11 items-center border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4'>
        <div>
          <div className='text-[10px] font-semibold uppercase text-[var(--color-text-secondary)]'>Agent</div>
          <div className='text-[13px] font-semibold text-[var(--color-text-primary)]'>{activeSession?.title || t('sessions.current')}</div>
        </div>
        <span className='ml-auto rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-text-secondary)]'>{messages.length}</span>
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto bg-[var(--color-bg-primary)]'>
        <div className='mx-auto max-w-3xl space-y-3 px-4 py-4'>
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
  const showDetails = steps.length > 1;
  return (
    <div className='rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-xs text-[var(--color-text-primary)]'>
      <div className={showDetails ? 'mb-2 flex items-center gap-2' : 'flex items-center gap-2'}>
        <span className='flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)]'>
          <span className='h-2 w-2 animate-pulse rounded-full bg-[var(--color-accent)]' />
        </span>
        <span className='font-semibold'>{t('chat.thinking')}</span>
        <span className='ml-auto text-[10px] text-[var(--color-text-secondary)]'>{t('chat.processing')}</span>
      </div>

      {showDetails && (
        <div className='space-y-1.5'>
          {steps.map((step) => (
            <div key={step.id} className='flex gap-2 rounded-[var(--radius-control)] bg-[var(--color-bg-primary)] px-2.5 py-1.5'>
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
      )}

      {queue.length > 0 && (
        <div className='mt-2 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-2'>
          <div className='mb-1 flex items-center text-[11px] font-medium text-[var(--color-text-secondary)]'>
            {t('chat.queue')} · {queue.length}
            <span className='ml-auto font-normal'>{t('chat.queueHint')}</span>
          </div>
          <div className='space-y-1'>
            {queue.slice(0, 3).map((item) => (
              <div key={item.id} className='truncate rounded-[var(--radius-control)] bg-[var(--color-bg-secondary)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)]'>
                {item.kind === 'command' ? '/' : ''}{item.content || ((item.imageDataUrls?.length || 0) > 1 ? t('chat.imagesDefault') : t('chat.imageDefault'))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
