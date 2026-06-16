import { useState, useEffect, useRef } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { useChatStore } from '../../stores/chatStore';
import { useI18n } from '../../lib/i18n';

const commands = [
  { id: 'open', label: 'Open HTML File', icon: '📂', desc: 'Open and parse an HTML page' },
  { id: 'export', label: 'Export Page', icon: '📦', desc: 'Export to PPTX, Markdown, or PNG' },
  { id: 'ai', label: 'AI Generate', icon: '🤖', desc: 'Generate page content with AI' },
  { id: 'theme', label: 'Apply Theme', icon: '🎨', desc: 'Change page theme and style' },
  { id: 'publish', label: 'Publish Package', icon: '🚀', desc: 'Package page for sharing' },
  { id: 'media', label: 'Process Media', icon: '🎬', desc: 'Add video, audio, or subtitles' },
];

export function CommandPalette() {
  const { t } = useI18n();
  const toggleCommandPalette = useUIStore((s) => s.toggleCommandPalette);
  const sendCommand = useChatStore((s) => s.sendCommand);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const localizedCommands = commands.map((cmd) => ({
    ...cmd,
    label: cmd.id === 'open' ? t('sidebar.chooseFolder')
      : cmd.id === 'export' ? t('editor.export')
      : cmd.id === 'ai' ? 'AI'
      : cmd.id === 'theme' ? t('theme.light') + ' / ' + t('theme.dark')
      : cmd.label,
    desc: cmd.id === 'open' ? t('welcome.open')
      : cmd.id === 'export' ? t('welcome.export')
      : cmd.id === 'ai' ? t('welcome.generate')
      : cmd.desc,
  }));

  const filtered = localizedCommands.filter((c) =>
    c.label.toLowerCase().includes(query.toLowerCase()) ||
    c.id.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    inputRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggleCommandPalette();
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1)); }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); }
      if (e.key === 'Enter') {
        const cmd = filtered[selectedIndex];
        if (cmd) { sendCommand(`/${cmd.id}`); toggleCommandPalette(); }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [filtered, selectedIndex]);

  return (
    <div className='fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50' onClick={toggleCommandPalette}>
      <div className='w-[500px] bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-xl shadow-2xl overflow-hidden' onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
          placeholder={t('chat.placeholder')}
          className='w-full bg-transparent px-4 py-3 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)]/50 outline-none border-b border-[var(--color-border)]'
        />
        <div className='max-h-64 overflow-y-auto'>
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                i === selectedIndex ? 'bg-[var(--color-accent)]/20' : 'hover:bg-[var(--color-bg-tertiary)]'
              }`}
              onClick={() => { sendCommand(`/${cmd.id}`); toggleCommandPalette(); }}
            >
              <span className='text-lg'>{cmd.icon}</span>
              <div>
                <div className='text-sm text-[var(--color-text-primary)] font-medium'>{cmd.label}</div>
                <div className='text-xs text-[var(--color-text-secondary)]'>{cmd.desc}</div>
              </div>
              <span className='ml-auto text-xs text-[var(--color-text-secondary)]/50 font-mono'>/{cmd.id}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
