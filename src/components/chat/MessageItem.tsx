import type { AgentToolEvent, ChatMessage, WorkflowStep } from '../../types';

interface Props { message: ChatMessage }

export function MessageItem({ message }: Props) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const images = message.imageDataUrls?.length ? message.imageDataUrls : message.imageDataUrl ? [message.imageDataUrl] : [];

  return (
    <div className={`flex gap-2.5 ${isUser ? 'justify-end' : ''}`}>
      {!isUser && (
        <div className='flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[9px] font-semibold text-[var(--color-text-secondary)]'>
          {isSystem ? 'SYS' : 'AI'}
        </div>
      )}
      <div className={`max-w-[86%] px-3 py-2 text-[13px] leading-6 ${
        isUser
          ? 'rounded-[var(--radius-panel)] bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] shadow-sm'
        : isSystem
          ? 'text-[var(--color-text-secondary)]'
          : 'text-[var(--color-text-primary)]'
      }`}>
        <div className='whitespace-pre-wrap'>{message.content}</div>
        {images.length > 0 && (
          <div className='mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3'>
            {images.map((src, index) => (
              <img
                key={`${message.id}-image-${index}`}
                src={src}
                alt={`attached ${index + 1}`}
                className='h-28 w-full rounded-lg border border-white/20 object-cover'
              />
            ))}
          </div>
        )}
        {message.toolEvents && message.toolEvents.length > 0 && (
          <ToolTrace events={message.toolEvents} />
        )}
        {message.workflow && message.workflow.length > 0 && (
          <WorkflowTrace steps={message.workflow} />
        )}
      </div>
    </div>
  );
}

function ToolTrace({ events }: { events: AgentToolEvent[] }) {
  return (
    <details className='mt-2 rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/70 px-2 py-1.5 text-[11px]'>
      <summary className='cursor-pointer select-none font-medium text-[var(--color-text-secondary)]'>
        工具轮 · {events.length}
      </summary>
      <div className='mt-2 space-y-2'>
        {events.map((event, index) => (
          <div key={`${event.id}-${index}`} className='rounded-[var(--radius-control)] bg-[var(--color-bg-primary)] p-2'>
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
    <details className='mt-2 rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/70 px-2 py-1.5 text-[11px]'>
      <summary className='cursor-pointer select-none font-medium text-[var(--color-text-secondary)]'>
        Workflow · {steps.length}
      </summary>
      <div className='mt-2 space-y-1.5'>
        {steps.map((step) => {
          const failed = typeof step.status === 'object' && 'Failed' in step.status;
          return (
            <div key={step.id} className='rounded-[var(--radius-control)] bg-[var(--color-bg-primary)] p-2'>
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
