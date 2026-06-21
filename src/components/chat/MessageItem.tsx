import { Bot, Check, Info, PencilLine, User } from 'lucide-react';
import type { AgentToolEvent, ChatMessage, ClarificationOption, WorkflowStep } from '../../types';
import { useChatStore } from '../../stores/chatStore';
import { ProcessingTimeline } from './ProcessingTimeline';

interface Props { message: ChatMessage }

export function MessageItem({ message }: Props) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const images = message.imageDataUrls?.length ? message.imageDataUrls : message.imageDataUrl ? [message.imageDataUrl] : [];
  const hasClarification = !isUser && message.clarification && normalizeClarificationOptions(message.clarification.options).length > 0;

  return (
    <div className={`render-contained flex gap-2.5 ${isUser ? 'justify-end' : ''}`}>
      {!isUser && (
        <div className='mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)]'>
          {isSystem ? <Info size={14} /> : <Bot size={14} />}
        </div>
      )}
      <div className={`max-w-[86%] px-3 py-2 text-[13px] leading-6 ${
        isUser
          ? 'rounded-[var(--radius-panel)] bg-[var(--color-accent-soft)] text-[var(--color-text-primary)] shadow-[inset_0_0_0_1px_var(--color-border)]'
        : isSystem
          ? 'text-[var(--color-text-secondary)]'
          : 'text-[var(--color-text-primary)]'
        }`}>
        <div className='whitespace-pre-wrap'>{message.content}</div>
        {hasClarification && (
          <ClarificationChoices message={message} />
        )}
        {images.length > 0 && (
          <div className='mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3'>
            {images.map((src, index) => (
              <img
                key={`${message.id}-image-${index}`}
                src={src}
                alt={`attached ${index + 1}`}
                width={160}
                height={112}
                loading='lazy'
                className='h-28 w-full rounded-lg border border-white/20 object-cover'
              />
            ))}
          </div>
        )}
        {message.processingTrace && message.processingTrace.length > 0 && (
          <ProcessingTimeline
            steps={message.processingTrace}
            qualityChecks={message.qualityChecks}
          />
        )}
        {message.toolEvents && message.toolEvents.length > 0 && (
          <ToolTrace events={message.toolEvents} />
        )}
        {message.workflow && message.workflow.length > 0 && (
          <WorkflowTrace steps={message.workflow} />
        )}
      </div>
      {isUser && (
        <div className='mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-text-primary)] text-[var(--color-bg-secondary)]'>
          <User size={13} />
        </div>
      )}
    </div>
  );
}

function ClarificationChoices({ message }: { message: ChatMessage }) {
  const sendMessage = useChatStore((s) => s.sendMessage);
  const sendCommand = useChatStore((s) => s.sendCommand);
  const setInputValue = useChatStore((s) => s.setInputValue);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const clarification = message.clarification;
  const options = normalizeClarificationOptions(clarification?.options);
  if (!clarification || options.length === 0) return null;

  const zh = containsCjk(clarification.question || message.content);
  const choose = (option: ClarificationOption) => {
    if (isProcessing) return;
    if (option.command) {
      void sendCommand(option.command, option.params);
      return;
    }
    const reply = option.reply || buildClarificationReply(option, clarification, zh);
    void sendMessage(reply, clarification.imageDataUrls);
  };
  const custom = () => {
    const original = clipText(clarification.originalRequest || '', 90);
    const value = zh
      ? original ? `基于刚才的需求「${original}」，我补充：` : '我想补充：'
      : original ? `For my previous request "${original}", I want to add: ` : 'I want to add: ';
    setInputValue(value);
    window.dispatchEvent(new CustomEvent('seehtml:focus-chat-input'));
  };

  return (
    <div className='mt-3 space-y-2'>
      <div className='grid gap-2'>
        {options.map((option) => (
          <button
            key={`${message.id}-${option.label}`}
            type='button'
            disabled={isProcessing}
            onClick={() => choose(option)}
            className='group flex min-h-9 w-full items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2.5 py-2 text-left text-[12px] font-medium text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)] disabled:cursor-not-allowed disabled:opacity-55'
            title={option.description || (zh ? `选择：${option.label}` : `Choose: ${option.label}`)}
          >
            <span className='flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-bg-secondary)] text-[var(--color-accent)] transition-colors group-hover:bg-[var(--color-accent)] group-hover:text-white'>
              <Check size={12} />
            </span>
            <span className='min-w-0 flex-1 break-words leading-4'>
              <span className='inline-flex flex-wrap items-center gap-1.5'>
                <span>{option.label}</span>
                {option.recommended && (
                  <span className='rounded-[var(--radius-control)] bg-[var(--color-accent-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-accent)]'>
                    {zh ? '推荐' : 'Recommended'}
                  </span>
                )}
              </span>
              {option.description && (
                <span className='mt-0.5 block text-[11px] font-normal leading-4 text-[var(--color-text-secondary)]'>
                  {option.description}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
      <button
        type='button'
        disabled={isProcessing}
        onClick={custom}
        className='inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-[11px] font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-primary)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-55'
        title={zh ? '在输入框里写自己的补充' : 'Write a custom answer in the input box'}
      >
        <PencilLine size={12} />
        {zh ? '自定义补充' : 'Custom answer'}
      </button>
    </div>
  );
}

function buildClarificationReply(
  option: ClarificationOption,
  clarification: NonNullable<ChatMessage['clarification']>,
  zh: boolean,
): string {
  const original = clipText(clarification.originalRequest || '', 120);
  if (zh) {
    const prefix = original ? `基于刚才的需求「${original}」，` : '';
    return `${prefix}我选择「${option.label}」，按这个方向继续。`;
  }
  const prefix = original ? `For my previous request "${original}", ` : '';
  return `${prefix}I choose "${option.label}". Continue in this direction.`;
}

function normalizeClarificationOptions(options?: unknown): ClarificationOption[] {
  if (!Array.isArray(options)) return [];
  return options
    .map((option): ClarificationOption | null => {
      if (typeof option === 'string') return { label: option };
      if (!option || typeof option !== 'object') return null;
      const record = option as Record<string, unknown>;
      if (typeof record.label !== 'string' || !record.label.trim()) return null;
      return {
        label: record.label,
        description: typeof record.description === 'string' ? record.description : undefined,
        recommended: record.recommended === true,
        reply: typeof record.reply === 'string' ? record.reply : undefined,
        command: typeof record.command === 'string' ? record.command : undefined,
        params: record.params,
      };
    })
    .filter((option): option is ClarificationOption => Boolean(option));
}

function ToolTrace({ events }: { events: AgentToolEvent[] }) {
  return (
    <details className='mt-2 rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-1.5 text-[11px]'>
      <summary className='cursor-pointer select-none font-medium text-[var(--color-text-secondary)]'>
        工具轮 · {events.length}
      </summary>
      <div className='mt-2 space-y-2'>
        {events.map((event, index) => (
          <div key={`${event.id}-${index}`} className='rounded-[var(--radius-control)] bg-[var(--color-bg-secondary)] p-2'>
            <div className='flex items-center gap-2'>
              <span className={`h-2 w-2 rounded-full ${event.error ? 'bg-[var(--color-danger)]' : 'bg-[var(--color-success)]'}`} />
              <code className='font-mono text-[11px] text-[var(--color-accent)]'>{event.name}</code>
            </div>
            {event.arguments !== undefined && (
              <div className='mt-1 rounded-[var(--radius-control)] bg-black/5 p-2 font-mono text-[10px] text-[var(--color-text-secondary)]'>
                {formatValue(event.arguments, 360)}
              </div>
            )}
            {event.result !== undefined && (
              <div className='mt-1 rounded-[var(--radius-control)] bg-black/5 p-2 text-[10px] text-[var(--color-text-secondary)]'>
                {formatToolResult(event.result)}
              </div>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

function WorkflowTrace({ steps }: { steps: WorkflowStep[] }) {
  return (
    <details className='mt-2 rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-1.5 text-[11px]'>
      <summary className='cursor-pointer select-none font-medium text-[var(--color-text-secondary)]'>
        Workflow · {steps.length}
      </summary>
      <div className='mt-2 space-y-1.5'>
        {steps.map((step) => {
          const failed = typeof step.status === 'object' && 'Failed' in step.status;
          return (
            <div key={step.id} className='rounded-[var(--radius-control)] bg-[var(--color-bg-secondary)] p-2'>
              <div className='flex items-center gap-2'>
                <span className={`h-2 w-2 rounded-full ${failed ? 'bg-[var(--color-danger)]' : 'bg-[var(--color-success)]'}`} />
                <code className='font-mono text-[11px] text-[var(--color-accent)]'>{step.agent}.{step.action}</code>
                <span className='ml-auto text-[10px] text-[var(--color-text-secondary)]'>{formatStatus(step.status)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}

function formatStatus(status: WorkflowStep['status']): string {
  if (typeof status === 'string') return status;
  if ('Failed' in status) return 'Failed';
  return 'Done';
}

function containsCjk(value: string): boolean {
  return value.split('').some((ch) => /[\u4e00-\u9fff]/.test(ch));
}

function clipText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function formatValue(value: unknown, maxLength = 1200): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n...` : text;
}

function formatToolResult(value: unknown): string {
  const error = extractError(value);
  if (error) return `失败：${error}`;
  const path = extractPath(value);
  if (path) return `输出：${path}`;
  const html = extractHtml(value);
  if (html) return '已返回 HTML，预览已刷新。';
  return formatValue(value, 420);
}

function extractError(value: unknown): string | null {
  if (typeof value === 'string') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const error = extractError(item);
      if (error) return error;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return typeof record.error === 'string' ? record.error : null;
}

function extractPath(value: unknown): string | null {
  if (typeof value === 'string') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const path = extractPath(item);
      if (path) return path;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  for (const key of ['output_path', 'package_path', 'path']) {
    if (typeof record[key] === 'string') return record[key];
  }
  return null;
}

function extractHtml(value: unknown): boolean {
  if (typeof value === 'string') return /<!doctype html|<html[\s>]|<section[\s>]/i.test(value);
  if (Array.isArray(value)) return value.some(extractHtml);
  if (!value || typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).some(extractHtml);
}
