import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Activity, Bot, CheckCircle2, Clock3, Folder, Loader2, RadioTower, XCircle } from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import type { ChatSession } from '../../stores/chatStore';
import { usePreviewStore, type PreviewRenderStatus } from '../../stores/previewStore';
import { useUIStore } from '../../stores/uiStore';
import { MessageItem } from './MessageItem';
import { ChatInput } from './ChatInput';
import { ProcessingTimeline } from './ProcessingTimeline';
import { useI18n, type Lang } from '../../lib/i18n';
import type { ProcessingStep, QueuedRequest } from '../../types';

export function ChatPanel() {
  const { t } = useI18n();
  const messages = useChatStore((s) => s.messages);
  const sessions = useChatStore((s) => s.sessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const processingSteps = useChatStore((s) => s.processingSteps);
  const queuedRequests = useChatStore((s) => s.queuedRequests);
  const renderStatus = usePreviewStore((s) => s.renderStatus);
  const projectPath = useUIStore((s) => s.projectPath);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [activeSessionId, sessions],
  );
  const messageCount = messages.length;
  const processingStepCount = processingSteps.length;
  const queuedRequestCount = queuedRequests.length;

  const updateStickToBottom = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    endRef.current?.scrollIntoView({ behavior: isProcessing ? 'auto' : 'smooth', block: 'end' });
  }, [isProcessing, messageCount, processingStepCount, queuedRequestCount]);

  return (
    <section className='w-[410px] min-w-[360px] flex-none overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-bg-secondary)] max-xl:h-[340px] max-xl:w-full max-xl:min-w-0 max-xl:border-l-0 max-xl:border-t'>
      <div className='flex h-full min-h-0 flex-col'>
      <div className='flex h-11 items-center border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3'>
        <div className='min-w-0'>
          <div className='text-[11px] font-semibold text-[var(--color-text-secondary)]'>{t('chat.title')}</div>
          <div className='truncate text-[13px] font-semibold text-[var(--color-text-primary)]'>{activeSession?.title || t('sessions.current')}</div>
        </div>
        <span className='ml-auto inline-flex h-6 items-center rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 text-[11px] font-medium text-[var(--color-text-secondary)]'>{messages.length}</span>
      </div>
      <div className='border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2'>
        <AgentActivity
          session={activeSession}
          projectPath={projectPath}
          isProcessing={isProcessing}
          steps={processingSteps}
          queue={queuedRequests}
          renderStatus={renderStatus}
        />
      </div>
      <div
        ref={scrollRef}
        onScroll={updateStickToBottom}
        className='min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[var(--color-bg-secondary)]'
      >
        <div className='space-y-3 px-3 py-4'>
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

function AgentActivity({
  session,
  projectPath,
  isProcessing,
  steps,
  queue,
  renderStatus,
}: {
  session?: ChatSession;
  projectPath: string | null;
  isProcessing: boolean;
  steps: ProcessingStep[];
  queue: QueuedRequest[];
  renderStatus: PreviewRenderStatus | null;
}) {
  const { t, lang } = useI18n();
  const folderPath = session?.projectPath || projectPath;
  const folderName = folderPath ? basename(folderPath) : t('chat.noFolder');
  const activeStep = steps.find((step) => step.status === 'active') || steps.find((step) => step.status === 'pending') || steps[steps.length - 1];
  const isRendering = renderStatus?.state === 'queued' || renderStatus?.state === 'running';
  const stateLabel = isProcessing
    ? t('status.processing')
    : isRendering
    ? t('chat.backgroundTask')
    : t('chat.ready');
  const stateClass = isProcessing || isRendering
    ? 'text-[var(--color-warning)]'
    : renderStatus?.state === 'error'
    ? 'text-[var(--color-danger)]'
    : 'text-[var(--color-success)]';
  const StateIcon = isProcessing || isRendering
    ? Loader2
    : renderStatus?.state === 'error'
    ? XCircle
    : CheckCircle2;

  return (
    <div className='rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-3 shadow-sm'>
      <div className='flex min-w-0 items-start gap-2.5'>
        <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'>
          <Bot size={17} />
        </div>
        <div className='min-w-0 flex-1'>
          <div className='flex min-w-0 items-center gap-2'>
            <div className='truncate text-[13px] font-semibold text-[var(--color-text-primary)]'>{t('chat.projectAgent')}</div>
            <span className={`ml-auto inline-flex items-center gap-1 text-[10px] font-medium ${stateClass}`}>
              <StateIcon size={11} className={isProcessing || isRendering ? 'animate-spin' : ''} />
              {stateLabel}
            </span>
          </div>
          <div className='mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--color-text-secondary)]' title={folderPath || undefined}>
            <Folder size={12} className='flex-shrink-0' />
            <span className='truncate'>{folderName}</span>
          </div>
        </div>
      </div>

      {activeStep && (
        <div className='mt-3 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 py-2'>
          <div className='flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-text-primary)]'>
            <Activity size={12} className='text-[var(--color-accent)]' />
            {t('chat.activeStep')}
          </div>
          <div className='mt-1 truncate text-xs font-medium text-[var(--color-text-primary)]'>{activeStep.title}</div>
          <div className='mt-0.5 line-clamp-2 text-[11px] leading-4 text-[var(--color-text-secondary)]'>{activeStep.detail}</div>
        </div>
      )}

      {renderStatus && (
        <div className='mt-2 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 py-2' title={renderStatus.outputPath || renderStatus.message}>
          <div className='flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-text-primary)]'>
            <RadioTower size={12} className={isRendering ? 'animate-pulse text-[var(--color-warning)]' : 'text-[var(--color-text-secondary)]'} />
            {t('chat.backgroundTask')}
            <span className='ml-auto text-[10px] font-normal text-[var(--color-text-secondary)]'>{formatRenderTime(renderStatus.updatedAt, lang)}</span>
          </div>
          <div className='mt-1 truncate text-[11px] leading-4 text-[var(--color-text-secondary)]'>{renderStatus.message}</div>
        </div>
      )}

      {queue.length > 0 && (
        <div className='mt-2 flex items-center gap-1.5 rounded-[var(--radius-control)] bg-[var(--color-bg-secondary)] px-2.5 py-2 text-[11px] text-[var(--color-text-secondary)]'>
          <Clock3 size={12} />
          <span className='font-medium text-[var(--color-text-primary)]'>{t('chat.queue')}</span>
          <span>{queue.length}</span>
          <span className='ml-auto truncate'>{queue[0]?.content || t('chat.queueHint')}</span>
        </div>
      )}
    </div>
  );
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function formatRenderTime(value: string, lang: Lang): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return lang === 'zh' ? '刚刚' : 'now';
  if (diff < 3_600_000) return lang === 'zh' ? `${Math.floor(diff / 60_000)} 分钟前` : `${Math.floor(diff / 60_000)}m ago`;
  return date.toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ProcessingTrace({ steps, queue }: { steps: ProcessingStep[]; queue: QueuedRequest[] }) {
  const { t } = useI18n();
  return (
    <div className='text-xs text-[var(--color-text-primary)]'>
      <ProcessingTimeline steps={steps} running compact />

      {queue.length > 0 && (
        <div className='mt-2 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 py-2'>
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
