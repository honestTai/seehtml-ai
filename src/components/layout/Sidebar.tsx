import { useState, useEffect } from 'react';
import { Folder, FolderOpen, FolderPlus, MessageSquare, MessageSquarePlus } from 'lucide-react';
import { getLanguage, setLanguage, useI18n, type Lang } from '../../lib/i18n';
import { getTheme, setTheme, type ThemeMode } from '../../lib/theme';
import { createProjectInSelectedParent, pickExistingProject } from '../../lib/workspace';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';

function basename(path: string | null): string {
  if (!path) return '';
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export function Sidebar() {
  const { t } = useI18n();
  const [lang, setLang] = useState<Lang>(getLanguage());
  const [theme, setThemeState] = useState<ThemeMode>(getTheme());
  const newSession = useChatStore((s) => s.newSession);
  const switchSession = useChatStore((s) => s.switchSession);
  const ensureProjectSession = useChatStore((s) => s.ensureProjectSession);
  const sessions = useChatStore((s) => s.sessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const projectPath = useUIStore((s) => s.projectPath);
  const setProjectPath = useUIStore((s) => s.setProjectPath);
  const visibleSessions = sessions.filter((session) => {
    if (projectPath) return samePath(session.projectPath, projectPath);
    return !session.projectPath;
  });

  useEffect(() => {
    const onLangChange = () => setLang(getLanguage());
    window.addEventListener('languagechange', onLangChange);
    return () => window.removeEventListener('languagechange', onLangChange);
  }, []);

  useEffect(() => {
    if (projectPath) ensureProjectSession(projectPath);
  }, [ensureProjectSession, projectPath]);

  const createProject = async () => {
    try {
      const selected = await createProjectInSelectedParent();
      if (selected) {
        setProjectPath(selected);
        ensureProjectSession(selected);
      }
    } catch {
      // The file tree below will show any unavailable-runtime state in dev browsers.
    }
  };

  const openProject = async () => {
    try {
      const selected = await pickExistingProject();
      if (selected) {
        setProjectPath(selected);
        ensureProjectSession(selected);
      }
    } catch {
      // The file tree below will show any unavailable-runtime state in dev browsers.
    }
  };

  return (
    <aside className='w-[248px] flex-shrink-0 overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-sidebar)] max-lg:w-[218px]'>
      <div className='flex h-full min-h-0 flex-col px-2 py-2'>
        <div className='space-y-0.5 border-b border-[var(--color-border)] pb-2'>
          <NavButton label={t('sessions.new')} icon={<MessageSquarePlus size={15} />} onClick={() => newSession(projectPath)} disabled={isProcessing} />
          <NavButton label={t('project.new')} icon={<FolderPlus size={15} />} onClick={createProject} />
          <NavButton label={t('project.open')} icon={<FolderOpen size={15} />} onClick={openProject} />
        </div>

        <div className='min-h-0 flex-1 overflow-y-auto py-2.5'>
          <SectionLabel>{projectPath ? t('project.title') : t('sessions.title')}</SectionLabel>
          <SidebarRow
            active={Boolean(projectPath)}
            title={projectPath ? basename(projectPath) : t('project.noProject')}
            meta={projectPath ? (isProcessing ? t('status.processing') : t('status.ready')) : t('project.chooseHint')}
            titleText={projectPath || undefined}
          />

          <div className='mt-1 space-y-0.5'>
            {visibleSessions.map((session) => (
              <SessionRow
                key={session.id}
                title={session.title}
                meta={`${Math.max(0, session.messages.filter((message) => message.role !== 'system' || message.id !== 'welcome').length)} ${t('chat.messages')}`}
                active={session.id === activeSessionId}
                disabled={isProcessing}
                onClick={() => switchSession(session.id)}
              />
            ))}
            {visibleSessions.length === 0 && (
              <button
                onClick={() => newSession(projectPath)}
                disabled={isProcessing}
                className='ml-6 flex h-8 w-[calc(100%-1.5rem)] items-center gap-2 rounded-[var(--radius-control)] px-2 text-left text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] disabled:opacity-50'
              >
                <MessageSquarePlus size={14} />
                <span>{t('sessions.new')}</span>
              </button>
            )}
          </div>
        </div>

        <div className='border-t border-[var(--color-border)] pt-2'>
          <div className='mb-2 flex items-center gap-1 text-[10px] text-[var(--color-text-secondary)]'>
            <button onClick={() => { setLanguage('zh'); setLang('zh'); }}
              className={`rounded-[var(--radius-control)] px-1.5 py-0.5 ${lang==='zh'?'bg-[var(--color-accent)] text-white':'hover:bg-[var(--color-bg-secondary)]'}`}>
              {t('lang.zh')}
            </button>
            <button onClick={() => { setLanguage('en'); setLang('en'); }}
              className={`rounded-[var(--radius-control)] px-1.5 py-0.5 ${lang==='en'?'bg-[var(--color-accent)] text-white':'hover:bg-[var(--color-bg-secondary)]'}`}>
              {t('lang.en')}
            </button>
            <span className='flex-1' />
            <button onClick={() => { setTheme('light'); setThemeState('light'); }}
              className={`rounded-[var(--radius-control)] px-1.5 py-0.5 ${theme==='light'?'bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] shadow-sm':''}`} title={t('theme.light')}>L</button>
            <button onClick={() => { setTheme('dark'); setThemeState('dark'); }}
              className={`rounded-[var(--radius-control)] px-1.5 py-0.5 ${theme==='dark'?'bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] shadow-sm':''}`} title={t('theme.dark')}>D</button>
            <button onClick={() => { setTheme('auto'); setThemeState('auto'); }}
              className={`rounded-[var(--radius-control)] px-1.5 py-0.5 ${theme==='auto'?'bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] shadow-sm':''}`} title={t('theme.auto')}>A</button>
          </div>
          <div className={`inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-2 py-1 text-[10px] font-medium ${isProcessing ? 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]' : 'bg-[var(--color-success)]/10 text-[var(--color-success)]'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isProcessing ? 'bg-[var(--color-warning)]' : 'bg-[var(--color-success)]'}`} />
            {isProcessing ? t('status.processing') : t('status.ready')}
          </div>
        </div>
      </div>
    </aside>
  );
}

function NavButton({ label, icon, onClick, disabled }: { label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className='flex h-7 w-full items-center gap-2 rounded-[var(--radius-control)] px-2 text-left text-[13px] font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-secondary)] disabled:cursor-default disabled:opacity-45'
    >
      <span className='flex h-4 w-4 items-center justify-center text-[var(--color-text-secondary)]'>{icon}</span>
      <span className='truncate'>{label}</span>
    </button>
  );
}

function SessionRow({
  title,
  meta,
  active,
  disabled,
  onClick,
}: {
  title: string;
  meta: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`ml-6 flex h-8 w-[calc(100%-1.5rem)] items-center gap-2 rounded-[var(--radius-control)] px-2 text-left text-[12px] transition-colors disabled:cursor-default disabled:opacity-50 ${
        active
          ? 'bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] shadow-[inset_0_0_0_1px_var(--color-border)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text-primary)]'
      }`}
      title={title}
    >
      <MessageSquare size={14} className='flex-shrink-0 text-[var(--color-text-secondary)]' />
      <span className='min-w-0 flex-1 truncate'>{title}</span>
      <span className='text-[10px] opacity-65'>{meta}</span>
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className='mb-1.5 px-2 text-[11px] font-medium text-[var(--color-text-secondary)]'>
      {children}
    </div>
  );
}

function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase()
    === b.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
}

function SidebarRow({
  title,
  meta,
  active,
  inset,
  titleText,
}: {
  title: string;
  meta: string;
  active?: boolean;
  inset?: boolean;
  titleText?: string;
}) {
  return (
    <button
      className={`mb-1 flex h-8 w-full items-center gap-2 rounded-[var(--radius-control)] px-2 text-left text-[13px] transition-colors ${
      active
        ? 'bg-[var(--color-bg-secondary)] text-[var(--color-text-primary)] shadow-[inset_0_0_0_1px_var(--color-border)]'
        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] hover:text-[var(--color-text-primary)]'
    } ${inset ? 'pl-7' : ''}`}
      title={titleText}
    >
      {!inset && <Folder size={14} className='flex-shrink-0 text-[var(--color-text-secondary)]' />}
      <span className='min-w-0 flex-1 truncate'>{title}</span>
      <span className='text-[10px] opacity-70'>{meta}</span>
    </button>
  );
}
