import type { Lang } from './i18n';

export type Mp4ExportProfileId = 'fast' | 'standard' | 'quality';

export interface Mp4ExportProfile {
  id: Mp4ExportProfileId;
  fps: number;
  fileSuffix: string;
  label: Record<Lang, string>;
  shortLabel: Record<Lang, string>;
  description: Record<Lang, string>;
}

export const DEFAULT_MP4_EXPORT_PROFILE_ID: Mp4ExportProfileId = 'standard';

export const MP4_EXPORT_PROFILES: Mp4ExportProfile[] = [
  {
    id: 'fast',
    fps: 12,
    fileSuffix: 'fast',
    label: { zh: '快速版', en: 'Fast' },
    shortLabel: { zh: '快', en: 'F' },
    description: {
      zh: '12fps，1 分钟约 720 帧，导出最快，适合预览和发样。',
      en: '12fps, about 720 frames per minute. Fastest for previews and drafts.',
    },
  },
  {
    id: 'standard',
    fps: 15,
    fileSuffix: 'standard',
    label: { zh: '标准版', en: 'Standard' },
    shortLabel: { zh: '标', en: 'S' },
    description: {
      zh: '15fps，1 分钟约 900 帧，速度和流畅度均衡，默认推荐。',
      en: '15fps, about 900 frames per minute. Balanced and recommended.',
    },
  },
  {
    id: 'quality',
    fps: 30,
    fileSuffix: 'quality',
    label: { zh: '高清版', en: 'Quality' },
    shortLabel: { zh: '高', en: 'Q' },
    description: {
      zh: '30fps，1 分钟约 1800 帧，最流畅但导出最慢。',
      en: '30fps, about 1800 frames per minute. Smoothest but slowest.',
    },
  },
];

export function getMp4ExportProfile(id?: string | null): Mp4ExportProfile {
  return MP4_EXPORT_PROFILES.find((profile) => profile.id === id) || MP4_EXPORT_PROFILES[1];
}

export function toMp4ExportProfileId(value: unknown): Mp4ExportProfileId | null {
  if (typeof value !== 'string') return null;
  return MP4_EXPORT_PROFILES.some((profile) => profile.id === value)
    ? value as Mp4ExportProfileId
    : null;
}

export function inferMp4ExportProfileId(text: string): Mp4ExportProfileId | null {
  const normalized = text.toLowerCase();
  if (/快速|预览|草稿|低帧|快一点|快点|fast|draft|preview|12\s*fps|12帧/.test(normalized)) return 'fast';
  if (/高清|高质量|高帧|流畅|最好|30\s*fps|30帧|quality|high|smooth/.test(normalized)) return 'quality';
  if (/标准|均衡|推荐|默认|15\s*fps|15帧|standard|balanced|default/.test(normalized)) return 'standard';
  return null;
}

export function mp4ProfileLabel(profile: Mp4ExportProfile, lang: Lang): string {
  return profile.label[lang] || profile.label.en;
}

export function mp4ProfileShortLabel(profile: Mp4ExportProfile, lang: Lang): string {
  return profile.shortLabel[lang] || profile.shortLabel.en;
}

export function mp4ProfileOptionLabel(profile: Mp4ExportProfile, lang: Lang): string {
  return `${mp4ProfileLabel(profile, lang)} ${profile.fps}fps`;
}

export function mp4ProfileDescription(profile: Mp4ExportProfile, lang: Lang): string {
  return profile.description[lang] || profile.description.en;
}

export function mp4ProfileFileName(profile: Mp4ExportProfile): string {
  return `presentation-${profile.fileSuffix}.mp4`;
}
