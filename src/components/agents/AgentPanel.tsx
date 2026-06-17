import { useState, useEffect } from 'react';

interface AgentInfo {
  id: string;
  name: string;
  emoji: string;
  state: string | { Failed: string };
  capabilities: { action: string; description: string }[];
}

const defaultAgents: AgentInfo[] = [
  { id: 'Orchestrator', name: 'Orchestrator', emoji: '🎯', state: 'Idle', capabilities: [] },
  { id: 'Document', name: 'PageAgent', emoji: '📄', state: 'Idle', capabilities: [
    { action: 'parse_html', description: 'Parse marketing HTML page' },
    { action: 'read_html_string', description: 'Parse HTML string' },
  ]},
  { id: 'Content', name: 'ContentAgent', emoji: '🤖', state: 'Idle', capabilities: [
    { action: 'generate', description: 'Generate AI content via 4Router' },
    { action: 'enhance_html', description: 'Enhance content with AI' },
  ]},
  { id: 'Style', name: 'StyleAgent', emoji: '🎨', state: 'Idle', capabilities: [
    { action: 'apply_theme', description: 'Apply marketing page theme' },
  ]},
  { id: 'Media', name: 'MediaAgent', emoji: '🎬', state: 'Idle', capabilities: [
    { action: 'process', description: 'Process media files' },
    { action: 'parse_subtitle', description: 'Parse subtitles (SRT/VTT)' },
  ]},
  { id: 'Export', name: 'ExportAgent', emoji: '📦', state: 'Idle', capabilities: [
    { action: 'export_pptx', description: 'Export to PowerPoint' },
    { action: 'export_markdown', description: 'Export to Markdown' },
    { action: 'export_png', description: 'Export to PNG' },
  ]},
  { id: 'Publish', name: 'PublishAgent', emoji: '🚀', state: 'Idle', capabilities: [
    { action: 'package', description: 'Package for distribution' },
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
