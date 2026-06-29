import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Activity, CheckCircle2, Clock3, Folder, Loader2, RadioTower, Route, ScanLine, Sparkles, XCircle } from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import type { ChatSession } from '../../stores/chatStore';
import { usePreviewStore, type PreviewRenderStatus } from '../../stores/previewStore';
import { useUIStore } from '../../stores/uiStore';
import { MessageItem } from './MessageItem';
import { ChatInput } from './ChatInput';
import { ProcessingTimeline } from './ProcessingTimeline';
import { useI18n, type Lang } from '../../lib/i18n';
import type { ProcessingStep, QueuedRequest } from '../../types';
import { buildLongChainPhases, type LongChainPhaseStatus } from '../../lib/longChainDisplay';

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
  const chatPanelWidth = useUIStore((s) => s.chatPanelWidth);
  const setChatPanelWidth = useUIStore((s) => s.setChatPanelWidth);
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const widthRef = useRef(chatPanelWidth);
  const [agentTab, setAgentTab] = useState<'chat' | 'timeline'>('chat');
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [activeSessionId, sessions],
  );
  const messageCount = messages.length;
  const processingStepCount = processingSteps.length;
  const queuedRequestCount = queuedRequests.length;

  useEffect(() => {
    widthRef.current = chatPanelWidth;
  }, [chatPanelWidth]);

  const updateStickToBottom = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    endRef.current?.scrollIntoView({ behavior: isProcessing ? 'auto' : 'smooth', block: 'end' });
  }, [isProcessing, messageCount, processingStepCount, queuedRequestCount]);

  const startResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (window.matchMedia('(max-width: 1279px)').matches) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widthRef.current;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const move = (moveEvent: PointerEvent) => {
      setChatPanelWidth(startWidth + startX - moveEvent.clientX);
    };
    const stop = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }, [setChatPanelWidth]);

  return (
    <section
      className='chat-panel-resizable relative min-w-[360px] flex-none overflow-hidden border-l border-[var(--color-border)] bg-[var(--color-bg-primary)] p-4 max-[900px]:h-[360px] max-[900px]:min-w-0 max-[900px]:border-l-0 max-[900px]:border-t'
      style={{ '--seehtml-chat-panel-width': `${chatPanelWidth}px` } as CSSProperties}
    >
      <button
        type='button'
        className='absolute inset-y-0 left-0 z-20 hidden w-2 cursor-col-resize touch-none border-l border-transparent hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]/60 max-xl:hidden xl:block'
        aria-label='Resize Agent panel'
        title='拖动调整 Agent 面板宽度'
        onPointerDown={startResize}
      />
      <div className='flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-white shadow-[0_18px_42px_rgba(15,23,42,0.08)]'>
      <div className='flex h-16 items-center border-b border-[var(--color-border)] bg-white px-5'>
        <div className='min-w-0'>
          <div className='flex items-center gap-2'>
            <div className='text-[18px] font-bold text-[var(--color-text-primary)]'>Agent</div>
            <span className='inline-flex h-5 items-center rounded-full bg-emerald-50 px-2 text-[10px] font-semibold text-emerald-600 border border-emerald-100/80 shadow-sm gap-1.5'>
              <span className='h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse' />
              Online
            </span>
          </div>
          <div className='truncate text-[12px] font-medium text-[var(--color-text-secondary)]'>{activeSession?.title || t('sessions.current')}</div>
        </div>
        <span className='ml-auto inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-accent)] hover:bg-[var(--color-bg-tertiary)]'>
          <Sparkles size={16} />
          {messages.length}
        </span>
      </div>
      <div className='flex h-12 items-center px-5 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]'>
        <div className='flex w-full gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-0.5 shadow-sm'>
          <button
            type='button'
            onClick={() => setAgentTab('chat')}
            aria-pressed={agentTab === 'chat'}
            className={`flex-1 rounded-md py-1.5 text-center text-xs font-semibold transition-all cursor-pointer ${agentTab === 'chat' ? 'bg-white text-[var(--color-text-primary)] shadow-sm' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
          >
            Chat
          </button>
          <button
            type='button'
            onClick={() => setAgentTab('timeline')}
            aria-pressed={agentTab === 'timeline'}
            className={`flex-1 rounded-md py-1.5 text-center text-xs font-semibold transition-all cursor-pointer ${agentTab === 'timeline' ? 'bg-white text-[var(--color-text-primary)] shadow-sm' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
          >
            Timeline
          </button>
        </div>
      </div>
      <div className='border-b border-[var(--color-border)] bg-white px-5 py-4'>
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
        className='min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white'
      >
        <div className='space-y-4 px-5 py-5'>
          {agentTab === 'chat' ? (
            <>
              {messages.map((msg) => (
                <MessageItem key={msg.id} message={msg} />
              ))}
              {isProcessing && <ProcessingTrace steps={processingSteps} queue={queuedRequests} />}
            </>
          ) : (
            <ProcessingTrace steps={processingSteps} queue={queuedRequests} />
          )}
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
  const phases = buildLongChainPhases(steps, isProcessing || isRendering);
  const stateLabel = isProcessing
    ? t('status.processing')
    : isRendering
    ? t('chat.backgroundTask')
    : t('chat.ready');
  const StateIcon = isProcessing || isRendering
    ? Loader2
    : renderStatus?.state === 'error'
    ? XCircle
    : CheckCircle2;

  return (
    <div className='overflow-hidden rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-white shadow-sm'>
      <div className='border-b border-[var(--color-border)] bg-white px-3 py-3'>
        <div className='flex min-w-0 items-center gap-2'>
          <div className='flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-white'>
            <Route size={17} />
          </div>
          <div className='min-w-0 flex-1'>
            <div className='flex min-w-0 items-center gap-2'>
              <div className='truncate text-[13px] font-semibold'>LongChain</div>
              <span className={`ml-auto inline-flex items-center gap-1 text-[10px] font-medium ${isProcessing || isRendering ? 'text-[var(--color-warning)]' : 'text-[var(--color-success)]'}`}>
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
        <div className='mt-3 grid grid-cols-3 gap-1.5'>
          {phases.map((phase) => (
            <LongChainPhasePill
              key={phase.id}
              label={phase.label[lang]}
              status={phase.status}
            />
          ))}
        </div>
      </div>

      <div className='px-3 py-3'>
      {activeStep && (
        <div className='border-b border-dashed border-[var(--color-border)] pb-2.5'>
          <div className='flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-text-primary)]'>
            <Activity size={12} className='text-[var(--color-accent)]' />
            {t('chat.activeStep')}
          </div>
          <div className='mt-1 truncate text-xs font-medium text-[var(--color-text-primary)]'>{activeStep.title}</div>
          <div className='mt-0.5 line-clamp-2 text-[11px] leading-4 text-[var(--color-text-secondary)]'>{activeStep.detail}</div>
        </div>
      )}

      {renderStatus && (
        <div className='mt-2 border-b border-dashed border-[var(--color-border)] pb-2.5' title={renderStatus.outputPath || renderStatus.message}>
          <div className='flex items-center gap-1.5 text-[11px] font-semibold text-[var(--color-text-primary)]'>
            <RadioTower size={12} className={isRendering ? 'animate-pulse text-[var(--color-warning)]' : 'text-[var(--color-text-secondary)]'} />
            {t('chat.backgroundTask')}
            <span className='ml-auto text-[10px] font-normal text-[var(--color-text-secondary)]'>{formatRenderTime(renderStatus.updatedAt, lang)}</span>
          </div>
          <div className='mt-1 truncate text-[11px] leading-4 text-[var(--color-text-secondary)]'>{renderStatus.message}</div>
        </div>
      )}

      {queue.length > 0 && (
        <div className='mt-2 flex items-center gap-1.5 text-[11px] text-[var(--color-text-secondary)]'>
          <Clock3 size={12} />
          <span className='font-medium text-[var(--color-text-primary)]'>{t('chat.queue')}</span>
          <span>{queue.length}</span>
          <span className='ml-auto truncate'>{queue[0]?.content || t('chat.queueHint')}</span>
        </div>
      )}
      {!activeStep && !renderStatus && queue.length === 0 && (
        <div className='flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)]'>
          <ScanLine size={13} className='text-[var(--color-accent)]' />
          <span>{lang === 'zh' ? '等待选择页面、图片或导出任务' : 'Waiting for a page, image, or export task'}</span>
        </div>
      )}
      </div>
    </div>
  );
}

function LongChainPhasePill({ label, status }: { label: string; status: LongChainPhaseStatus }) {
  const active = status === 'active';
  const done = status === 'done';
  const error = status === 'error';
  return (
    <div className={`flex h-8 min-w-0 items-center justify-center gap-1 rounded-[var(--radius-control)] border px-1.5 text-[10px] font-semibold ${
      error
        ? 'border-[#ffb4a6] bg-[#3a1b18] text-[#ffd3c7]'
        : active
        ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
        : done
        ? 'border-[#bbf7d0] bg-[#ecfdf3] text-[#16a34a]'
        : 'border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)]'
    }`}>
      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
        error ? 'bg-[var(--color-danger)]' : active ? 'animate-pulse bg-[var(--color-accent)]' : done ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-tertiary)]'
      }`} />
      <span className='truncate'>{label}</span>
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
