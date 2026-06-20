import { useState } from 'react';
import { useChatStore } from '../../stores/chatStore';

interface Skill {
  id: string;
  name: string;
  emoji: string;
  description: string;
  tools: string[]; // Tool chain: tools called in sequence
  naturalPrompt: string; // Natural language prompt for the LLM agent loop
  command?: string;
}

const skills: Skill[] = [
  {
    id: 'html-generate',
    name: 'HTML Generator',
    emoji: '◆',
    description: '生成或修改完整 HTML，内置页面质量约束、动画逐帧导出约束和 iframe 预览约束。',
    tools: ['content.generate', 'content.enhance_html'],
    naturalPrompt: '生成一个高质量 HTML：',
  },
  {
    id: 'ppt-export',
    name: 'Export PowerPoint',
    emoji: '▣',
    description: '把当前 HTML 按页面导出为 PPTX，一页 HTML 对应一页 PowerPoint。',
    tools: ['export.export_pptx'],
    naturalPrompt: '导出当前 HTML 为 PPTX',
    command: '/export pptx',
  },
  {
    id: 'mp4-export',
    name: 'Export MP4',
    emoji: '▶',
    description: '用预览渲染器逐帧采集动画，再通过 FFmpeg 合成 1080p MP4。',
    tools: ['preview.render_frames', 'ffmpeg.encode_mp4'],
    naturalPrompt: '导出当前 HTML 为高质量 MP4',
    command: '/export video quality',
  },
];

export function SkillsPanel() {
  const sendMessage = useChatStore((s) => s.sendMessage);
  const sendCommand = useChatStore((s) => s.sendCommand);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState('');

  const handleRunSkill = (skill: Skill) => {
    const prompt = customPrompt.trim();
    if (prompt) {
      sendMessage(prompt);
    } else if (skill.command) {
      sendCommand(skill.command, { display: skill.naturalPrompt });
    } else {
      sendMessage(skill.naturalPrompt);
    }
    setCustomPrompt('');
  };

  return (
    <div className="py-2">
      <div className="px-3 py-1 text-[10px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">
        Core Agent Flow ({skills.length})
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
