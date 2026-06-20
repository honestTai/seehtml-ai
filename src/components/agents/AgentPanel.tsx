import { useState } from 'react';

interface AgentInfo {
  id: string;
  name: string;
  emoji: string;
  state: string | { Failed: string };
  capabilities: { action: string; description: string }[];
}

const defaultAgents: AgentInfo[] = [
  { id: 'Orchestrator', name: 'AgentPlanner', emoji: '◇', state: 'Idle', capabilities: [
    { action: 'plan', description: 'Understand the user request before any tool call' },
    { action: 'clarify', description: 'Ask one follow-up question when the brief is unclear' },
  ] },
  { id: 'Content', name: 'HTMLAgent', emoji: '◆', state: 'Idle', capabilities: [
    { action: 'generate_html', description: 'Generate complete previewable HTML' },
    { action: 'enhance_html', description: 'Edit existing HTML with quality checks' },
  ]},
  { id: 'Export', name: 'ExportRenderer', emoji: '▣', state: 'Idle', capabilities: [
    { action: 'export_pptx', description: 'Export HTML pages to PowerPoint' },
    { action: 'render_mp4', description: 'Render animated HTML frames and encode MP4' },
  ]},
];

export function AgentPanel() {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className='py-2'>
      <div className='px-3 py-1 text-[10px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider'>
        Agent System
      </div>
      {defaultAgents.map((agent) => (
        <div key={agent.id} className='mx-2 mb-0.5'>
          <button
            onClick={() => setExpanded(expanded === agent.id ? null : agent.id)}
            className='w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--color-bg-tertiary)] transition-colors text-left'
          >
            <span className='text-sm'>{agent.emoji}</span>
            <span className='text-xs text-[var(--color-text-primary)] flex-1'>{agent.name}</span>
            <span className={`w-2 h-2 rounded-full ${
              agent.state === 'Idle' ? 'bg-green-400' :
              agent.state === 'Running' ? 'bg-yellow-400 animate-pulse' :
              typeof agent.state === 'object' ? 'bg-red-400' : 'bg-gray-400'
            }`} />
          </button>
          {expanded === agent.id && (
            <div className='ml-8 mb-1'>
              {agent.capabilities.map((cap) => (
                <div key={cap.action} className='text-[11px] text-[var(--color-text-secondary)] py-0.5'>
                  <span className='font-mono text-[var(--color-accent)]'>{cap.action}</span>
                  <span className='ml-1 opacity-70'>— {cap.description}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
