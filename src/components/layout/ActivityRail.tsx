import type React from 'react';
import { Command, Files, MessageSquare, PanelLeft, Settings, Sparkles } from 'lucide-react';
import { useUIStore } from '../../stores/uiStore';
import { useI18n } from '../../lib/i18n';

export function ActivityRail() {
  const { t } = useI18n();
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const workspaceMode = useUIStore((s) => s.workspaceMode);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const toggleCommandPalette = useUIStore((s) => s.toggleCommandPalette);
  const setWorkspaceMode = useUIStore((s) => s.setWorkspaceMode);
  const openModelSettings = useUIStore((s) => s.setModelSettingsOpen);
  const showFiles = () => {
    setWorkspaceMode('files');
    if (!sidebarOpen) toggleSidebar();
  };

  return (
    <nav className='flex h-full w-[52px] flex-shrink-0 flex-col items-center border-r border-[var(--color-border)] bg-[var(--color-rail)] py-2'>
      <div className='mb-3 flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-accent)] text-[13px] font-bold text-white shadow-sm'>
        S
      </div>
      <RailButton label={t('sidebar.workspace')} active={sidebarOpen} onClick={toggleSidebar}><PanelLeft size={18} /></RailButton>
      <RailButton label={t('sidebar.fileTree')} active={workspaceMode === 'files'} onClick={showFiles}><Files size={18} /></RailButton>
      <RailButton label={t('chat.title')} onClick={toggleCommandPalette}><MessageSquare size={18} /></RailButton>
      <RailButton label='AI' onClick={toggleCommandPalette}><Sparkles size={18} /></RailButton>
      <div className='mt-auto flex flex-col gap-1'>
        <RailButton label='Ctrl+K' onClick={toggleCommandPalette}><Command size={17} /></RailButton>
        <RailButton label={t('settings.modelTitle')} onClick={() => openModelSettings(true)}><Settings size={17} /></RailButton>
      </div>
    </nav>
  );
}

function RailButton({
  children,
  label,
  active,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active ? 'true' : undefined}
      className={`mb-1 flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] text-sm transition-colors ${
        active
          ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] shadow-[inset_0_0_0_1px_var(--color-border)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      {children}
    </button>
  );
}
