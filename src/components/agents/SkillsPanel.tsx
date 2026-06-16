import { useState } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { HTML_SKILLS } from '../../lib/htmlSkills';

interface Skill {
  id: string;
  name: string;
  emoji: string;
  description: string;
  tools: string[]; // Tool chain: tools called in sequence
  naturalPrompt: string; // Natural language prompt for the LLM agent loop
}

const skills: Skill[] = [
  {
    id: 'frontend-slides-quality', name: 'Frontend Slides Skill', emoji: '🧩',
    description: 'Built-in HTML quality skill for deck-like pages: full HTML document, responsive slide layout, polished visual hierarchy, and iframe-safe preview.',
    tools: ['html.skill.frontend_slides', 'html.quality_gate'],
    naturalPrompt: '使用 Frontend Slides Skill 生成一套高质量 HTML 演示页：',
  },
  {
    id: 'motion-html-quality', name: 'Motion HTML Skill', emoji: '✨',
    description: 'Built-in HTML quality skill for particles, Canvas, animation, and MP4-ready looping pages.',
    tools: ['html.skill.motion_html', 'html.quality_gate'],
    naturalPrompt: '使用 Motion HTML Skill 生成一个高质量动效 HTML：',
  },
  {
    id: 'landing-html-quality', name: 'Landing HTML Skill', emoji: '🌐',
    description: 'Built-in HTML quality skill for landing pages and product pages with responsive layout, strong hierarchy, and polished copy.',
    tools: ['html.skill.landing_html', 'html.quality_gate'],
    naturalPrompt: '使用 Landing HTML Skill 生成一个高质量页面：',
  },
  {
    id: 'slide-gen', name: 'Slide Generator', emoji: '📊',
    description: 'Generate HTML marketing pages from any topic using AI. Creates styled, structured page content.',
    tools: ['content.generate'],
    naturalPrompt: 'Generate 5 beautiful HTML pages about: ',
  },
  {
    id: 'html-parse', name: 'HTML Parser', emoji: '📄',
    description: 'Parse an HTML file into structured sections. Extracts headings, content, and metadata.',
    tools: ['document.parse_html'],
    naturalPrompt: 'Parse the HTML file at: ',
  },
  {
    id: 'html-enhance', name: 'HTML Enhancer', emoji: '✨',
    description: 'Enhance HTML content with AI: improve styling, readability, accessibility, and add visual elements.',
    tools: ['content.enhance_html'],
    naturalPrompt: 'Enhance and beautify this HTML content: ',
  },
  {
    id: 'theme-apply', name: 'Theme Applier', emoji: '🎨',
    description: 'Apply a professional theme to your page. Supports custom colors, fonts, dark mode.',
    tools: ['style.apply_theme'],
    naturalPrompt: 'Apply a modern professional theme with primary color #2563EB to the page',
  },
  {
    id: 'export-full', name: 'Full Export Pipeline', emoji: '📦',
    description: 'Complete export chain: Enhance HTML → Apply theme → Export PPTX. One-click professional output.',
    tools: ['content.enhance_html', 'style.apply_theme', 'export.export_pptx'],
    naturalPrompt: 'Export the page as a professionally styled PPTX: enhance content, apply theme, then export',
  },
  {
    id: 'export-md', name: 'Markdown Export', emoji: '📝',
    description: 'Convert HTML page to clean Markdown format. Preserves structure and headings.',
    tools: ['export.export_markdown'],
    naturalPrompt: 'Export the current page as Markdown',
  },
  {
    id: 'ocr-extract', name: 'OCR Text Extract', emoji: '🔍',
    description: 'Extract text from images using OCR (EasyOCR). Supports Chinese + English.',
    tools: ['media.ocr'],
    naturalPrompt: 'Extract text from image file: ',
  },
  {
    id: 'video-make', name: 'Video Generator', emoji: '🎬',
    description: 'Convert page images into MP4 video using FFmpeg. Set duration and resolution.',
    tools: ['media.generate_video'],
    naturalPrompt: 'Generate a video from the page images in ./output/',
  },
  {
    id: 'package', name: 'Package & Publish', emoji: '🚀',
    description: 'Package page with all assets into a distributable folder. Ready for sharing.',
    tools: ['publish.package'],
    naturalPrompt: 'Package the page for distribution',
  },
];

export function SkillsPanel() {
  const sendMessage = useChatStore((s) => s.sendMessage);
  const sendCommand = useChatStore((s) => s.sendCommand);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');

  const handleRunSkill = (skill: Skill) => {
    const prompt = customPrompt || skill.naturalPrompt;
    sendMessage(prompt);
    setCustomPrompt('');
  };

  return (
    <div className="py-2">
      <div className="px-3 py-1 text-[10px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
        Skills ({skills.length}) · HTML Quality {HTML_SKILLS.length}
      </div>
      {skills.map((skill) => (
        <div key={skill.id} className="mx-2 mb-0.5">
          <button
            onClick={() => setExpanded(expanded === skill.id ? null : skill.id)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--color-bg-tertiary)] transition-colors text-left"
          >
            <span className="text-sm">{skill.emoji}</span>
            <span className="text-xs text-[var(--color-text-primary)] flex-1">{skill.name}</span>
            <span className="text-[10px] font-mono text-[var(--color-text-secondary)]/50">
              {skill.tools.length} tool{skill.tools.length > 1 ? 's' : ''}
            </span>
          </button>
          {expanded === skill.id && (
            <div className="ml-8 mb-2 pr-2">
              <p className="text-[11px] text-[var(--color-text-secondary)] py-1">{skill.description}</p>

              {/* Tool chain visualization */}
              <div className="flex items-center gap-1 my-1.5 flex-wrap">
                {skill.tools.map((tool, i) => (
                  <span key={tool} className="flex items-center gap-0.5">
                    <code className="text-[10px] px-1 py-0.5 bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded text-[var(--color-accent)]">
                      {tool}
                    </code>
                    {i < skill.tools.length - 1 && (
                      <span className="text-[10px] text-[var(--color-text-secondary)]">→</span>
                    )}
                  </span>
                ))}
              </div>

              {/* Custom prompt input */}
              <input
                type="text"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder={skill.naturalPrompt + '...'}
                className="w-full bg-[var(--color-bg-primary)] border border-[var(--color-border)] rounded px-2 py-1 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)]/40 mb-1.5"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRunSkill(skill);
                }}
              />

              <button
                onClick={() => handleRunSkill(skill)}
                className="text-[11px] px-2 py-0.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white rounded"
              >
                {isProcessing ? '追加到 Agent 队列' : '▶ Run via AI Agent'}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
