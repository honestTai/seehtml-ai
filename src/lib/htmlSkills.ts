import type { Lang } from './i18n';

export interface HtmlSkill {
  id: string;
  name: string;
  labelZh: string;
  labelEn: string;
  purposeZh: string;
  purposeEn: string;
}

export interface HtmlQualityCheck {
  id: string;
  label: string;
  passed: boolean;
}

export const HTML_SKILLS: HtmlSkill[] = [
  {
    id: 'frontend-slides',
    name: 'Frontend Slides',
    labelZh: 'Frontend Slides Skill',
    labelEn: 'Frontend Slides Skill',
    purposeZh: '用于演示页、PPT 风页面、多页叙事和自动预览 HTML。',
    purposeEn: 'For deck-like HTML, slide storytelling, and auto-previewable pages.',
  },
  {
    id: 'motion-html',
    name: 'Motion HTML',
    labelZh: 'Motion HTML Skill',
    labelEn: 'Motion HTML Skill',
    purposeZh: '用于粒子、动效、Canvas、可录制为视频的单页 HTML。',
    purposeEn: 'For particles, motion, Canvas, and video-recordable HTML pages.',
  },
  {
    id: 'landing-html',
    name: 'Landing HTML',
    labelZh: 'Landing HTML Skill',
    labelEn: 'Landing HTML Skill',
    purposeZh: '用于营销页、产品页、官网首屏和信息密度较高的页面。',
    purposeEn: 'For landing pages, product pages, and polished marketing pages.',
  },
  {
    id: 'html-refactor',
    name: 'HTML Refactor',
    labelZh: 'HTML Refactor Skill',
    labelEn: 'HTML Refactor Skill',
    purposeZh: '用于修改现有 HTML，保持结构稳定并提升视觉质量。',
    purposeEn: 'For improving existing HTML while preserving structure and behavior.',
  },
];

export function selectHtmlSkill(input: string, mode: 'create' | 'edit' | 'image'): HtmlSkill {
  if (mode === 'edit') return skillById('html-refactor');
  const text = input.toLowerCase();
  if (/(particle|canvas|webgl|three|animation|animate|motion|video|mp4|动效|动画|粒子|星河|炫酷|自动动|转为mp4)/i.test(text)) {
    return skillById('motion-html');
  }
  if (/(slide|slides|ppt|presentation|deck|演示|幻灯|汇报|课件|多页|分页|\d+\s*页)/i.test(input)) {
    return skillById('frontend-slides');
  }
  if (mode === 'image') return skillById('landing-html');
  return skillById('landing-html');
}

export function skillLabel(skill: HtmlSkill | undefined, lang: Lang): string {
  if (!skill) return lang === 'zh' ? 'HTML Quality Skill' : 'HTML Quality Skill';
  return lang === 'zh' ? skill.labelZh : skill.labelEn;
}

export function buildHtmlSkillPrompt(skill: HtmlSkill, lang: Lang): string {
  const shared = `Built-in HTML quality gate: ${skill.name}

Output contract:
- Return exactly one complete <!DOCTYPE html> document, not Markdown.
- Include <html>, <head>, <meta charset>, viewport meta, <title>, <style>, and <body>.
- Use inline CSS and inline JavaScript only; avoid external CDN/network dependencies.
- The page must render directly in an iframe preview and fill the available viewport.
- Use responsive layout with stable dimensions, no text overlap, no clipped buttons, no horizontal scrolling.
- Use polished typography, spacing, contrast, and visible hierarchy; avoid placeholder copy.
- Add accessible alt/aria text when useful, semantic landmarks, and reduced-motion handling when animation is present.
- For interactive or animated HTML, include a self-starting preview state and keep animation performant with requestAnimationFrame.
- Before finalizing, self-check: complete document, visual hierarchy, responsiveness, motion safety, and no unrelated tooling.`;

  if (skill.id === 'frontend-slides') {
    return `${shared}

Frontend Slides requirements:
- Build a deck-like HTML experience with clear slide sections or paged panels.
- Each slide needs a strong title, concise content, and a distinct visual composition.
- Include keyboard or on-screen navigation only when it improves the requested result.
- Fit each slide to the viewport without content overflow.`;
  }

  if (skill.id === 'motion-html') {
    return `${shared}

Motion HTML requirements:
- Prefer Canvas for particle or physics-like motion.
- Fill the viewport with the animation; keep controls minimal and non-obstructive.
- Make the first frame visually meaningful immediately, before interaction.
- If the user asks for MP4 later, design the animation as a clean loop suitable for recording.`;
  }

  if (skill.id === 'html-refactor') {
    return `${shared}

HTML Refactor requirements:
- Preserve the user's original intent and important content.
- Improve layout, visual rhythm, responsiveness, and readability.
- Do not remove working behavior unless explicitly asked.`;
  }

  return `${shared}

Landing HTML requirements:
- Create a real usable first screen, not a marketing explanation of the app.
- Use concrete sections, strong visual hierarchy, and domain-specific details.
- Make the design feel complete on desktop and mobile.`;
}

export function validateHtmlQuality(html: string, lang: Lang): HtmlQualityCheck[] {
  const lower = html.toLowerCase();
  const hasMotion = /requestanimationframe|<canvas|animation:|@keyframes/.test(lower);
  return [
    { id: 'doctype', label: lang === 'zh' ? '完整 HTML 文档' : 'Complete HTML document', passed: /<!doctype html/i.test(html) && /<html[\s>]/i.test(html) },
    { id: 'viewport', label: lang === 'zh' ? '移动端 viewport' : 'Mobile viewport', passed: /<meta[^>]+name=["']viewport["']/i.test(html) },
    { id: 'title', label: lang === 'zh' ? '页面标题' : 'Page title', passed: /<title[^>]*>[\s\S]+?<\/title>/i.test(html) },
    { id: 'style', label: lang === 'zh' ? '内联样式' : 'Inline styles', passed: /<style[\s>]/i.test(html) },
    { id: 'body', label: lang === 'zh' ? '主体内容' : 'Body content', passed: /<body[\s>][\s\S]*<\/body>/i.test(html) },
    { id: 'responsive', label: lang === 'zh' ? '响应式约束' : 'Responsive constraints', passed: /(@media|clamp\(|min\(|max\(|aspect-ratio|vh|vw|rem)/i.test(html) },
    { id: 'motion', label: lang === 'zh' ? '动效性能约束' : 'Motion performance', passed: !hasMotion || /requestanimationframe|prefers-reduced-motion/i.test(lower) },
  ];
}

export function summarizeHtmlQuality(checks: HtmlQualityCheck[], skill: HtmlSkill | undefined, lang: Lang): string {
  const passed = checks.filter((item) => item.passed).length;
  const total = checks.length;
  const failed = checks.filter((item) => !item.passed).map((item) => item.label);
  const label = skillLabel(skill, lang);
  if (failed.length === 0) {
    return lang === 'zh'
      ? `${label}：基础质量检查 ${passed}/${total} 通过。`
      : `${label}: base quality checks passed ${passed}/${total}.`;
  }
  return lang === 'zh'
    ? `${label}：基础质量检查 ${passed}/${total} 通过；建议补强：${failed.join('、')}。`
    : `${label}: base quality checks passed ${passed}/${total}; improve: ${failed.join(', ')}.`;
}

function skillById(id: string): HtmlSkill {
  return HTML_SKILLS.find((skill) => skill.id === id) || HTML_SKILLS[0];
}
