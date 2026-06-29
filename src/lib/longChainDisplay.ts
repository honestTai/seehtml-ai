export type LongChainPhaseId = 'plan' | 'execute' | 'synthesize';
export type LongChainPhaseStatus = 'idle' | 'pending' | 'active' | 'done' | 'error';

export interface LongChainPhase {
  id: LongChainPhaseId;
  label: {
    zh: string;
    en: string;
  };
  detail: string;
  status: LongChainPhaseStatus;
}

interface ProcessingLikeStep {
  title?: string;
  detail?: string;
  status?: string;
}

const PHASES: Array<Omit<LongChainPhase, 'detail' | 'status'>> = [
  { id: 'plan', label: { zh: '规划', en: 'Plan' } },
  { id: 'execute', label: { zh: '执行', en: 'Execute' } },
  { id: 'synthesize', label: { zh: '整理', en: 'Synthesize' } },
];

export function buildLongChainPhases(
  steps: ProcessingLikeStep[],
  running: boolean,
): LongChainPhase[] {
  const buckets: Record<LongChainPhaseId, ProcessingLikeStep | undefined> = {
    plan: findPhaseStep(steps, 'plan'),
    execute: findPhaseStep(steps, 'execute'),
    synthesize: findPhaseStep(steps, 'synthesize'),
  };

  if (!buckets.plan && steps.length > 0) buckets.plan = steps[0];
  if (!buckets.execute && steps.length > 1) buckets.execute = steps[Math.min(1, steps.length - 1)];
  if (!buckets.synthesize && steps.length > 2) buckets.synthesize = steps[steps.length - 1];

  return PHASES.map((phase, index) => {
    const step = buckets[phase.id];
    return {
      ...phase,
      detail: step?.detail || defaultDetail(phase.id),
      status: normalizeStatus(step?.status, running, index, Boolean(step)),
    };
  });
}

function findPhaseStep(steps: ProcessingLikeStep[], phase: LongChainPhaseId): ProcessingLikeStep | undefined {
  const pattern = phase === 'plan'
    ? /plan|规划|理解|需求|路由|route/i
    : phase === 'execute'
    ? /execute|执行|调用|生成|修改|tool|render|asset|ocr/i
    : /synthesize|整理|总结|质量|保存|导出|final|repair/i;
  return steps.find((step) => pattern.test(`${step.title || ''} ${step.detail || ''}`));
}

function normalizeStatus(
  status: string | undefined,
  running: boolean,
  index: number,
  hasStep: boolean,
): LongChainPhaseStatus {
  if (status === 'error') return 'error';
  if (status === 'active') return 'active';
  if (status === 'done') return 'done';
  if (status === 'pending') return 'pending';
  if (hasStep) return running ? (index === 0 ? 'done' : 'pending') : 'done';
  return 'idle';
}

function defaultDetail(id: LongChainPhaseId): string {
  if (id === 'plan') return 'Intent, context, and artifact route';
  if (id === 'execute') return 'Tools, HTML generation, or local OCR';
  return 'Quality pass and final response';
}
