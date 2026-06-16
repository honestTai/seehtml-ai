import type React from 'react';
import { useUIStore } from '../../stores/uiStore';
import { useI18n } from '../../lib/i18n';

export function ActivityRail() {
  const { t } = useI18n();
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const toggleCommandPalette = useUIStore((s) => s.toggleCommandPalette);

  return (
    <nav className='flex h-full w-14 flex-shrink-0 flex-col items-center border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] py-2'>
      <div className='mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--color-accent)] text-sm font-bold text-white shadow-sm'>
        S
      </div>
      <RailButton label={t('sidebar.workspace')} active onClick={toggleSidebar}>▣</RailButton>
      <RailButton label={t('sidebar.fileTree')} onClick={toggleSidebar}>▤</RailButton>
      <RailButton label={t('chat.title')} onClick={toggleCommandPalette}>⌘</RailButton>
      <div className='mt-auto flex flex-col gap-1'>
        <RailButton label='Ctrl+K' onClick={toggleCommandPalette}>⌕</RailButton>
        <RailButton label={t('theme.auto')}>⚙</RailButton>
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
      className={`mb-1 flex h-9 w-9 items-center justify-center rounded-xl text-sm transition-colors ${
        active
          ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
      }`}
    >
      {children}
    </button>
  );
}
