import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, Clock3, Loader2, MinusCircle } from 'lucide-react';
import type { ProcessingStep, QualityCheckResult } from '../../types';
import { useI18n } from '../../lib/i18n';

interface ProcessingTimelineProps {
  steps: ProcessingStep[];
  qualityChecks?: QualityCheckResult[];
  running?: boolean;
  compact?: boolean;
}

export function ProcessingTimeline({
  steps,
  qualityChecks = [],
  running = false,
  compact = false,
}: ProcessingTimelineProps) {
  const { lang } = useI18n();
  const [, setTick] = useState(0);
  const failed = steps.some((step) => step.status === 'error') || qualityChecks.some((check) => !check.passed);
  const startedAt = firstTimestamp(steps, 'startedAt');
  const completedAt = running ? undefined : lastTimestamp(steps, 'completedAt');
  const durationLabel = formatDuration(startedAt, completedAt, lang);
  const completedCount = steps.filter((step) => step.status === 'done').length;
  const activeStep = steps.find((step) => step.status === 'active');
  const passedQuality = qualityChecks.filter((check) => check.passed).length;
  const title = running
    ? lang === 'zh' ? '处理中' : 'Processing'
    : failed
    ? lang === 'zh' ? '已处理，有待检查' : 'Processed with checks'
    : lang === 'zh' ? '已处理' : 'Processed';

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const defaultOpen = running || failed || compact;
  const rows = useMemo(() => steps.filter(Boolean), [steps]);
  if (rows.length === 0 && qualityChecks.length === 0) return null;

  return (
    <details
      open={defaultOpen}
      className={`group mt-2 overflow-hidden rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[11px] shadow-sm ${compact ? 'mt-0' : ''}`}
    >
      <summary className='flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-[var(--color-text-primary)]'>
        <span className='flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]'>
          {running ? <Loader2 size={12} className='animate-spin' /> : failed ? <AlertCircle size={12} /> : <CheckCircle2 size={12} />}
        </span>
        <span className='font-semibold'>{title}</span>
        <span className='text-[var(--color-text-secondary)]'>{durationLabel}</span>
        {activeStep && (
          <span className='min-w-0 flex-1 truncate text-[var(--color-text-secondary)]'>
            {activeStep.title}
          </span>
        )}
        {!activeStep && rows.length > 0 && (
          <span className='ml-auto text-[var(--color-text-secondary)]'>
            {completedCount}/{rows.length}
          </span>
        )}
        <ChevronDown size={13} className='text-[var(--color-text-secondary)] transition-transform group-open:rotate-180' />
      </summary>

      <div className='border-t border-[var(--color-border)] px-3 py-2'>
        <div className='mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]'>
          <Clock3 size={12} />
          {lang === 'zh' ? '时间轴' : 'Timeline'}
        </div>
        <div className='space-y-2'>
          {rows.map((step, index) => (
            <TimelineRow
              key={`${step.id}-${index}`}
              step={step}
              isLast={index === rows.length - 1 && qualityChecks.length === 0}
              lang={lang}
            />
          ))}
        </div>

        {qualityChecks.length > 0 && (
          <div className='mt-3 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-2'>
            <div className='mb-2 flex items-center gap-2 text-[11px] font-semibold text-[var(--color-text-primary)]'>
              <CheckCircle2 size={12} className={passedQuality === qualityChecks.length ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]'} />
              {lang === 'zh' ? '质量检查' : 'Quality checks'}
              <span className='ml-auto text-[10px] font-normal text-[var(--color-text-secondary)]'>
                {passedQuality}/{qualityChecks.length}
              </span>
            </div>
            <div className='grid gap-1.5'>
              {qualityChecks.map((check) => (
                <div key={check.id} className='flex items-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-bg-primary)] px-2 py-1.5'>
                  {check.passed ? (
                    <CheckCircle2 size={12} className='flex-shrink-0 text-[var(--color-success)]' />
                  ) : (
                    <AlertCircle size={12} className='flex-shrink-0 text-[var(--color-warning)]' />
                  )}
                  <span className='min-w-0 flex-1 truncate text-[var(--color-text-primary)]'>{check.label}</span>
                  <span className='text-[10px] text-[var(--color-text-secondary)]'>
                    {check.passed ? (lang === 'zh' ? '通过' : 'Pass') : (lang === 'zh' ? '待补强' : 'Needs work')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

function TimelineRow({ step, isLast, lang }: { step: ProcessingStep; isLast: boolean; lang: 'zh' | 'en' }) {
  const failed = step.status === 'error';
  const running = step.status === 'active';
  const pending = step.status === 'pending';
  const Icon = failed ? AlertCircle : running ? Loader2 : pending ? MinusCircle : CheckCircle2;
  const statusClass = failed
    ? 'text-[var(--color-danger)]'
    : running
    ? 'text-[var(--color-accent)]'
    : pending
    ? 'text-[var(--color-text-secondary)]'
    : 'text-[var(--color-success)]';
  const duration = stepDuration(step, lang);

  return (
    <div className='relative flex gap-2'>
      {!isLast && (
        <span className='absolute left-[7px] top-5 h-[calc(100%-10px)] w-px bg-[var(--color-border)]' />
      )}
      <span className={`relative z-10 mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-primary)] ${statusClass}`}>
        <Icon size={13} className={running ? 'animate-spin' : ''} />
      </span>
      <div className='min-w-0 flex-1 rounded-[var(--radius-control)] bg-[var(--color-bg-secondary)] px-2.5 py-2'>
        <div className='flex min-w-0 items-center gap-2'>
          <div className='min-w-0 flex-1 truncate font-semibold text-[var(--color-text-primary)]'>{step.title}</div>
          <span className={`flex-shrink-0 text-[10px] ${statusClass}`}>{formatStepStatus(step.status, lang)}</span>
        </div>
        <div className='mt-1 whitespace-pre-wrap break-words leading-4 text-[var(--color-text-secondary)]'>{step.detail}</div>
        {duration && (
          <div className='mt-1 text-[10px] text-[var(--color-text-secondary)]'>{duration}</div>
        )}
      </div>
    </div>
  );
}

function formatStepStatus(status: ProcessingStep['status'], lang: 'zh' | 'en'): string {
  if (status === 'done') return lang === 'zh' ? '完成' : 'Done';
  if (status === 'active') return lang === 'zh' ? '进行中' : 'Running';
  if (status === 'error') return lang === 'zh' ? '异常' : 'Issue';
  return lang === 'zh' ? '等待' : 'Pending';
}

function firstTimestamp(steps: ProcessingStep[], key: 'startedAt' | 'completedAt'): string | undefined {
  return steps.map((step) => step[key]).find(Boolean);
}

function lastTimestamp(steps: ProcessingStep[], key: 'startedAt' | 'completedAt'): string | undefined {
  return [...steps].reverse().map((step) => step[key]).find(Boolean);
}

function formatDuration(start?: string, end?: string, lang: 'zh' | 'en' = 'zh'): string {
  if (!start) return '';
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return '';
  const total = Math.max(0, Math.floor((endMs - startMs) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (lang === 'zh') return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function stepDuration(step: ProcessingStep, lang: 'zh' | 'en'): string {
  if (!step.startedAt) return '';
  const end = step.completedAt || (step.status === 'active' ? new Date().toISOString() : undefined);
  const duration = formatDuration(step.startedAt, end, lang);
  if (!duration) return '';
  return lang === 'zh' ? `耗时 ${duration}` : `Duration ${duration}`;
}
