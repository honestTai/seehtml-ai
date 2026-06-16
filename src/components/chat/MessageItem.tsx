import type { AgentToolEvent, ChatMessage, WorkflowStep } from '../../types';

interface Props { message: ChatMessage }

export function MessageItem({ message }: Props) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  return (
    <div className={`flex gap-2 ${isUser ? 'justify-end' : ''}`}>
      {!isUser && (
        <div className='w-6 h-6 rounded-full bg-[var(--color-bg-tertiary)] flex items-center justify-center text-xs flex-shrink-0'>
          {message.agentEmoji || (isSystem ? '📋' : '🤖')}
        </div>
      )}
      <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed shadow-sm ${
        isUser
          ? 'rounded-br-md bg-[var(--color-accent)] text-white'
          : isSystem
          ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] border border-[var(--color-border)]'
          : 'rounded-bl-md border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]'
      }`}>
        <div className='whitespace-pre-wrap'>{message.content}</div>
        {message.imageDataUrl && (
          <img
            src={message.imageDataUrl}
            alt='attached'
            className='mt-2 max-h-40 max-w-full rounded border border-white/20 object-contain'
          />
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
    <details className='mt-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/70 px-2 py-1.5 text-[11px]'>
      <summary className='cursor-pointer select-none font-medium text-[var(--color-text-secondary)]'>
        Tool turns · {events.length}
      </summary>
      <div className='mt-2 space-y-2'>
        {events.map((event, index) => (
          <div key={`${event.id}-${index}`} className='rounded-lg bg-[var(--color-bg-primary)] p-2'>
            <div className='flex items-center gap-2'>
              <span className={`h-2 w-2 rounded-full ${event.error ? 'bg-[var(--color-danger)]' : 'bg-[var(--color-success)]'}`} />
              <code className='font-mono text-[11px] text-[var(--color-accent)]'>{event.name}</code>
            </div>
            {event.arguments !== undefined && (
              <pre className='mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded-lg bg-black/5 p-2 font-mono text-[10px] text-[var(--color-text-secondary)]'>
                {formatValue(event.arguments)}
              </pre>
            )}
            {event.result !== undefined && (
              <pre className='mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded-lg bg-black/5 p-2 font-mono text-[10px] text-[var(--color-text-secondary)]'>
                {formatValue(event.result)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

function WorkflowTrace({ steps }: { steps: WorkflowStep[] }) {
  return (
    <details className='mt-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/70 px-2 py-1.5 text-[11px]'>
      <summary className='cursor-pointer select-none font-medium text-[var(--color-text-secondary)]'>
        Workflow · {steps.length}
      </summary>
      <div className='mt-2 space-y-1.5'>
        {steps.map((step) => {
          const failed = typeof step.status === 'object' && 'Failed' in step.status;
          return (
            <div key={step.id} className='rounded-lg bg-[var(--color-bg-primary)] p-2'>
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

function formatValue(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (!text) return '';
  return text.length > 1200 ? `${text.slice(0, 1200)}\n...` : text;
}
