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
    purposeZh: '用于粒子、动效、赛博短视频、Canvas、可录制为视频的单页 HTML。',
    purposeEn: 'For particles, cyber short-video motion, Canvas, and video-recordable HTML pages.',
  },
  {
    id: 'canvas-video',
    name: 'Canvas Video',
    labelZh: 'Canvas Video Skill',
    labelEn: 'Canvas Video Skill',
    purposeZh: '用于 HTML5 Canvas 视频、粒子剧情、片头、宣传短片、小红书风格 MP4 导出。',
    purposeEn: 'For HTML5 Canvas videos, particle stories, intros, promo shorts, Xiaohongshu-style MP4 export.',
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
  if (/(mp4|video|movie|render|record|export|promo|intro|outro|trailer|canvas video|shorts|reels|小红书|爆款|视频|短片|宣传片|剧情|片头|片尾|录制|导出|渲染|一分钟|1\s*分钟|60\s*秒|60s)/i.test(text)) {
    return skillById('canvas-video');
  }
  if (/(particle|canvas|webgl|three|animation|animate|motion|video|mp4|cyber|neon|pixel|city|动效|动画|粒子|星河|炫酷|赛博|霓虹|像素|城市|镜头感|自动动|转为mp4)/i.test(text)) {
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
  const shared = `Built-in HTML quality thinking guide: ${skill.name}

Important boundary:
- This skill is an internal planning/checklist aid, not a product limitation.
- The current user request, supplied assets, explicit style, page count, and export target always take priority.
- Do not reject or reshape a valid user request just to fit this skill. If a skill note conflicts with the request, follow the request while keeping the HTML preview/export reliable.

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
- For open-ended particle/story requests with no stronger user direction, consider a short-video visual language: cyber/neon palette, pixel-city or abstract-tech environment, light streaks, parallax camera moves, kinetic title cards, and a clear hook-to-payoff beat.
- Use bold, readable headline typography with glow/shadow sparingly; the text should feel like a social video title, not a static webpage.
- If the user asks for MP4 later, design the animation as a clean loop suitable for recording.
- Support deterministic export frames when possible: listen for the seehtml:export-frame event and render from event.detail.time or window.__SEEHTML_EXPORT_TIME__ so exported MP4 motion stays smooth and repeatable.
- Keep a normal requestAnimationFrame preview path for live viewing, but make the render function accept a time value such as renderAtTime(seconds).`;
  }

  if (skill.id === 'canvas-video') {
    return `${shared}

Canvas Video requirements:
- Build one self-contained HTML5 Canvas animation with inline JavaScript; avoid external media, CDN scripts, and image dependencies unless the user supplied assets.
- Use a stable 16:9 stage designed for 1920x1080 export, then scale it responsively to fit the iframe preview without changing the logical coordinate system.
- When the brief is open-ended and no other genre is specified, a good default is a Xiaohongshu-friendly motion short: 8-15 second cinematic pacing, cyber-neon or particle-tech look, pixel/retro-future city accents, quick hook text, camera push/pan, particle bursts, and a resolved end-card.
- Define an explicit duration using window.__SEEHTML_EXPORT_DURATION__ and a DURATION constant. If the user gave a duration, honor it exactly within the app export limit.
- Make motion deterministic and frame-seekable: implement renderAtTime(seconds), assign window.renderAtTime = renderAtTime, and render the full frame from absolute time rather than accumulated deltas.
- Listen for window event "seehtml:export-frame" and render from event.detail.time; also read window.__SEEHTML_EXPORT_TIME__ when present.
- Use requestAnimationFrame only for live preview timing. Exported frames must not depend on wall-clock time, random drift, network loading, or hidden async state.
- Use seeded randomness or precomputed particles so frame N is reproducible every time. Do not mutate particle state in a way that makes seeking backward incorrect.
- Structure longer videos as a small timeline of scenes/beats with easing helpers, camera movement, text beats, and a clean loop or intentional ending.
- For story-like requests, use a 3-beat structure: setup visual world, escalation/transformation, title payoff/end card. Do not leave the video as only a background effect.
- The first frame must look deliberate, not blank; the final frame should either loop cleanly to the first frame or resolve to a stable end card.
- Keep per-frame work predictable: reuse arrays, avoid layout reads in the render loop, cap particle counts, and draw only what is visible.
- Include a minimal overlay label only when useful; it must not cover the primary animation or export-critical content.
- Respect prefers-reduced-motion in preview, but keep deterministic export support intact.`;
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

export function validateHtmlQuality(html: string, lang: Lang, skill?: HtmlSkill): HtmlQualityCheck[] {
  const lower = html.toLowerCase();
  const hasMotion = /requestanimationframe|<canvas|animation:|@keyframes/.test(lower);
  const checks = [
    { id: 'doctype', label: lang === 'zh' ? '完整 HTML 文档' : 'Complete HTML document', passed: /<!doctype html/i.test(html) && /<html[\s>]/i.test(html) },
    { id: 'viewport', label: lang === 'zh' ? '移动端 viewport' : 'Mobile viewport', passed: /<meta[^>]+name=["']viewport["']/i.test(html) },
    { id: 'title', label: lang === 'zh' ? '页面标题' : 'Page title', passed: /<title[^>]*>[\s\S]+?<\/title>/i.test(html) },
    { id: 'style', label: lang === 'zh' ? '内联样式' : 'Inline styles', passed: /<style[\s>]/i.test(html) },
    { id: 'body', label: lang === 'zh' ? '主体内容' : 'Body content', passed: /<body[\s>][\s\S]*<\/body>/i.test(html) },
    { id: 'responsive', label: lang === 'zh' ? '响应式约束' : 'Responsive constraints', passed: /(@media|clamp\(|min\(|max\(|aspect-ratio|vh|vw|rem)/i.test(html) },
    { id: 'motion', label: lang === 'zh' ? '动效性能约束' : 'Motion performance', passed: !hasMotion || /requestanimationframe|prefers-reduced-motion/i.test(lower) },
  ];
  if (skill?.id === 'canvas-video') {
    checks.push(
      { id: 'canvas', label: lang === 'zh' ? 'Canvas 舞台' : 'Canvas stage', passed: /<canvas[\s>]/i.test(html) },
      { id: 'duration', label: lang === 'zh' ? '显式时长' : 'Explicit duration', passed: /__SEEHTML_EXPORT_DURATION__|\bDURATION\b/i.test(html) },
      { id: 'seekable', label: lang === 'zh' ? '逐帧可寻址' : 'Frame-seekable render', passed: /renderAtTime|seehtml:export-frame|__SEEHTML_EXPORT_TIME__/i.test(html) },
    );
  }
  return checks;
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
