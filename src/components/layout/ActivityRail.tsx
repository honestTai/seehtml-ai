import type React from 'react';
import { Command, Files, MessageSquare, MousePointer2, PanelLeft, Settings, Sparkles } from 'lucide-react';
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
    <nav className='flex h-full w-[56px] flex-shrink-0 flex-col items-center border-r border-black/20 bg-[var(--color-rail)] py-2 text-white shadow-[inset_-1px_0_0_rgba(255,255,255,0.04)]'>
      <div className='mb-3 flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-white/10 bg-white text-[13px] font-black tracking-tight text-[#141719] shadow-sm'>
        SH
      </div>
      <RailButton label={t('sidebar.workspace')} active={sidebarOpen} onClick={toggleSidebar}><PanelLeft size={18} /></RailButton>
      <RailButton label={t('sidebar.fileTree')} active={workspaceMode === 'files'} onClick={showFiles}><Files size={18} /></RailButton>
      <RailButton label={t('chat.title')} onClick={toggleCommandPalette}><MessageSquare size={18} /></RailButton>
      <RailButton label='Select' onClick={toggleCommandPalette}><MousePointer2 size={18} /></RailButton>
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
      className={`mb-1 flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] text-sm transition-all ${
        active
          ? 'bg-[var(--color-accent)] text-white shadow-[0_2px_8px_rgba(59,130,246,0.3)] scale-[1.05]'
          : 'text-white/60 hover:bg-white/10 hover:text-white hover:scale-[1.02]'
      }`}
    >
      {children}
    </button>
  );
}
