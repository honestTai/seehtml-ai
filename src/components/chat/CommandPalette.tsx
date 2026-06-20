import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Bot, FilePlus2, FolderOpen, Settings, Video } from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';
import { useChatStore } from '../../stores/chatStore';
import { useI18n } from '../../lib/i18n';
import type { LucideIcon } from 'lucide-react';

const commands = [
  { id: 'open', label: 'Open HTML File', Icon: FolderOpen, desc: 'Open and parse an HTML page' },
  { id: 'ai', label: 'Generate HTML', Icon: Bot, desc: 'Generate or edit previewable HTML' },
  { id: 'export-pptx', label: 'Export PPT', Icon: FilePlus2, desc: 'Export current HTML one page per slide' },
  { id: 'export-video', label: 'Export MP4', Icon: Video, desc: 'Render current HTML animation to MP4' },
  { id: 'model-settings', label: 'Model Settings', Icon: Settings, desc: 'Configure any OpenAI-compatible model' },
];

export function CommandPalette() {
  const { t } = useI18n();
  const closeCommandPalette = useUIStore((s) => s.setCommandPaletteOpen);
  const setModelSettingsOpen = useUIStore((s) => s.setModelSettingsOpen);
  const sendCommand = useChatStore((s) => s.sendCommand);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const localizedCommands = useMemo(() => commands.map((cmd) => ({
    ...cmd,
    label: cmd.id === 'open' ? t('sidebar.chooseFolder')
      : cmd.id === 'ai' ? 'AI'
      : cmd.id === 'export-pptx' ? t('export.pptx')
      : cmd.id === 'export-video' ? t('export.video')
      : cmd.id === 'model-settings' ? t('settings.modelTitle')
      : cmd.label,
    desc: cmd.id === 'open' ? t('welcome.open')
      : cmd.id === 'ai' ? t('welcome.generate')
      : cmd.id === 'export-pptx' ? t('editor.exportPptx')
      : cmd.id === 'export-video' ? t('editor.exportVideo')
      : cmd.id === 'model-settings' ? t('settings.compatHint')
      : cmd.desc,
  })), [t]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return localizedCommands;
    return localizedCommands.filter((command) =>
      command.label.toLowerCase().includes(normalizedQuery) ||
      command.id.toLowerCase().includes(normalizedQuery)
    );
  }, [localizedCommands, query]);

  const closePalette = useCallback(() => closeCommandPalette(false), [closeCommandPalette]);

  const runCommand = useCallback((id: string) => {
    if (id === 'model-settings') {
      setModelSettingsOpen(true);
    } else if (id === 'export-pptx') {
      void sendCommand('/export pptx', { display: t('export.pptx'), format: 'pptx' });
    } else if (id === 'export-video') {
      void sendCommand('/export video quality', { display: t('export.video'), format: 'video', profileId: 'quality' });
    } else {
      void sendCommand(`/${id}`);
    }
    closePalette();
  }, [closePalette, sendCommand, setModelSettingsOpen, t]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex((index) => Math.min(index, Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePalette();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const command = filtered[selectedIndex];
      if (command) runCommand(command.id);
    }
  }, [closePalette, filtered, runCommand, selectedIndex]);

  return (
    <div className='fixed inset-0 z-50 flex items-start justify-center bg-black/35 px-4 pt-[15vh] backdrop-blur-sm' onClick={closePalette}>
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby='command-palette-title'
        className='w-full max-w-[520px] overflow-hidden rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl'
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h2 id='command-palette-title' className='sr-only'>{t('command.title')}</h2>
        <input
          ref={inputRef}
          name='command-search'
          aria-label={t('command.placeholder')}
          autoComplete='off'
          spellCheck={false}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
          placeholder={t('command.placeholder')}
          className='w-full border-b border-[var(--color-border)] bg-transparent px-4 py-3 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)]/55'
        />
        <div className='max-h-64 overflow-y-auto'>
          {filtered.map((cmd, i) => (
            <CommandRow
              key={cmd.id}
              command={cmd}
              active={i === selectedIndex}
              onClick={() => runCommand(cmd.id)}
            />
          ))}
          {filtered.length === 0 && (
            <div className='px-4 py-5 text-sm text-[var(--color-text-secondary)]'>
              {t('command.empty')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CommandRow({
  command,
  active,
  onClick,
}: {
  command: { id: string; label: string; desc: string; Icon: LucideIcon };
  active: boolean;
  onClick: () => void;
}) {
  const Icon = command.Icon;
  return (
    <button
      type='button'
      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
        active ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-bg-tertiary)]'
      }`}
      onClick={onClick}
    >
      <span className='flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] text-[var(--color-text-secondary)]'>
        <Icon size={15} aria-hidden='true' />
      </span>
      <div className='min-w-0'>
        <div className='truncate text-sm font-medium text-[var(--color-text-primary)]'>{command.label}</div>
        <div className='truncate text-xs text-[var(--color-text-secondary)]'>{command.desc}</div>
      </div>
      <span className='ml-auto font-mono text-xs text-[var(--color-text-secondary)]/55'>/{command.id}</span>
    </button>
  );
}
