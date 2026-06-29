import { useEffect, useMemo, useState } from 'react';
import { Clock3, Folder, FolderOpen, FolderPlus, MessageSquare, MessageSquarePlus, Plus, SlidersHorizontal } from 'lucide-react';
import { getLanguage, setLanguage, useI18n, type Lang } from '../../lib/i18n';
import { getTheme, setTheme, THEME_CHANGE_EVENT, type ThemeMode } from '../../lib/theme';
import { createProjectInSelectedParent, pickExistingProject } from '../../lib/workspace';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';

function basename(path: string | null): string {
  if (!path) return '';
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export function Sidebar() {
  const { t, lang: activeLang } = useI18n();
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
  const setWorkspaceMode = useUIStore((s) => s.setWorkspaceMode);
  const setWorkspaceSelectionPath = useUIStore((s) => s.setWorkspaceSelectionPath);
  const visibleSessions = useMemo(() => sessions.filter((session) => {
    if (projectPath) return samePath(session.projectPath, projectPath);
    return !session.projectPath;
  }), [projectPath, sessions]);

  useEffect(() => {
    const onLangChange = () => setLang(getLanguage());
    window.addEventListener('languagechange', onLangChange);
    return () => window.removeEventListener('languagechange', onLangChange);
  }, []);

  useEffect(() => {
    const onThemeChange = () => setThemeState(getTheme());
    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
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
    <aside className='w-[256px] flex-shrink-0 overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-sidebar)] max-lg:w-[232px] max-[680px]:hidden'>
      <div className='flex h-full min-h-0 flex-col'>
        <div className='flex h-[62px] items-center gap-2 border-b border-[var(--color-border)] px-6'>
          <div className='flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--color-border-strong)] bg-white text-[11px] font-bold text-[var(--color-accent)] shadow-sm'>
            S
          </div>
          <div className='min-w-0'>
            <div className='truncate text-[15px] font-bold tracking-tight text-[var(--color-text-primary)]'>SeeHTML <span className='font-medium text-[var(--color-accent)]'>AI</span></div>
          </div>
        </div>

        <div className='space-y-1 px-4 pb-4 pt-5'>
          <SectionLabel>PROJECT</SectionLabel>
          <SidebarRow
            active={Boolean(projectPath)}
            title={projectPath ? basename(projectPath) : 'Hyperframes Site'}
            meta={projectPath ? (isProcessing ? t('status.processing') : '') : ''}
            titleText={projectPath || undefined}
            onClick={() => {
              if (!projectPath) return;
              setWorkspaceSelectionPath(projectPath);
              setWorkspaceMode('files');
            }}
          />
          <NavButton label={t('project.new')} icon={<FolderPlus size={15} />} onClick={createProject} />
          <NavButton label={t('project.open')} icon={<FolderOpen size={15} />} onClick={openProject} />
        </div>

        <div className='mx-4 h-px bg-[var(--color-border)]' />

        <div className='min-h-0 flex-1 overflow-y-auto px-4 py-5'>
          <SectionLabel>SESSIONS</SectionLabel>
          <div className='mt-1 space-y-0.5'>
            {visibleSessions.map((session) => (
              <SessionRow
                key={session.id}
                title={session.title}
                meta={`${Math.max(0, session.messages.filter((message) => message.role !== 'system' || message.id !== 'welcome').length)} ${t('chat.messages')}`}
                time={formatSessionTime(session.updatedAt, activeLang)}
                active={session.id === activeSessionId}
                disabled={isProcessing}
                onClick={() => switchSession(session.id)}
              />
            ))}
            {visibleSessions.length === 0 && (
              <button
                type='button'
                onClick={() => newSession(projectPath)}
                disabled={isProcessing}
                className='flex h-9 w-full items-center gap-2 rounded-[var(--radius-control)] px-2 text-left text-[12px] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] disabled:opacity-50'
              >
                <MessageSquarePlus size={14} />
                <span>{t('sessions.noHistory')}</span>
              </button>
            )}
          </div>
        </div>

        <div className='border-t border-[var(--color-border)] px-4 py-4'>
          <button
            type='button'
            onClick={() => newSession(projectPath)}
            disabled={isProcessing}
            className='mb-3 flex h-9 w-full items-center gap-2 rounded-[var(--radius-control)] px-2 text-left text-[13px] font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] disabled:opacity-45'
          >
            <Plus size={16} className='text-[var(--color-accent)]' />
            <span className='flex-1'>{t('sessions.new')}</span>
            <SlidersHorizontal size={14} className='text-[var(--color-text-tertiary)]' />
          </button>
          <div className='mb-3 flex items-center justify-between gap-1 text-[11px] text-[var(--color-text-secondary)]'>
            <div className='flex items-center gap-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-0.5 shadow-sm'>
              <button
                type='button'
                onClick={() => { setLanguage('zh'); setLang('zh'); }}
                aria-pressed={lang === 'zh'}
                className={`rounded px-2 py-0.5 text-[10px] font-medium transition-all ${lang==='zh'?'bg-white text-[var(--color-text-primary)] shadow-sm':'hover:text-[var(--color-text-primary)]'}`}
              >
                {t('lang.zh')}
              </button>
              <button
                type='button'
                onClick={() => { setLanguage('en'); setLang('en'); }}
                aria-pressed={lang === 'en'}
                className={`rounded px-2 py-0.5 text-[10px] font-medium transition-all ${lang==='en'?'bg-white text-[var(--color-text-primary)] shadow-sm':'hover:text-[var(--color-text-primary)]'}`}
              >
                {t('lang.en')}
              </button>
            </div>

            <div className='flex items-center gap-0.5 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] p-0.5 shadow-sm'>
              <button
                type='button'
                onClick={() => { setTheme('light'); setThemeState('light'); }}
                aria-label={t('theme.light')}
                aria-pressed={theme === 'light'}
                className={`rounded px-2 py-0.5 text-[10px] font-medium transition-all ${theme==='light'?'bg-white text-[var(--color-text-primary)] shadow-sm':'hover:text-[var(--color-text-primary)]'}`}
                title={t('theme.light')}
              >
                L
              </button>
              <button
                type='button'
                onClick={() => { setTheme('dark'); setThemeState('dark'); }}
                aria-label={t('theme.dark')}
                aria-pressed={theme === 'dark'}
                className={`rounded px-2 py-0.5 text-[10px] font-medium transition-all ${theme==='dark'?'bg-white text-[var(--color-text-primary)] shadow-sm':'hover:text-[var(--color-text-primary)]'}`}
                title={t('theme.dark')}
              >
                D
              </button>
              <button
                type='button'
                onClick={() => { setTheme('auto'); setThemeState('auto'); }}
                aria-label={t('theme.auto')}
                aria-pressed={theme === 'auto'}
                className={`rounded px-2 py-0.5 text-[10px] font-medium transition-all ${theme==='auto'?'bg-white text-[var(--color-text-primary)] shadow-sm':'hover:text-[var(--color-text-primary)]'}`}
                title={t('theme.auto')}
              >
                A
              </button>
            </div>
          </div>
          <div className={`inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-2.5 py-1 text-[11px] font-semibold shadow-sm ${isProcessing ? 'text-[var(--color-warning)]' : 'text-[var(--color-success)]'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isProcessing ? 'bg-[var(--color-warning)] animate-pulse' : 'bg-[var(--color-success)]'}`} />
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
      type='button'
      onClick={onClick}
      disabled={disabled}
      className='flex h-8 w-full items-center gap-2 rounded-[var(--radius-control)] px-2 text-left text-[13px] font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)] disabled:cursor-default disabled:opacity-45'
    >
      <span className='flex h-4 w-4 items-center justify-center text-[var(--color-text-secondary)]'>{icon}</span>
      <span className='truncate'>{label}</span>
    </button>
  );
}

function SessionRow({
  title,
  meta,
  time,
  active,
  disabled,
  onClick,
}: {
  title: string;
  meta: string;
  time: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      className={`ml-6 flex min-h-10 w-[calc(100%-1.5rem)] items-center gap-2 rounded-[var(--radius-control)] px-2 py-1 text-left text-[12px] transition-colors disabled:cursor-default disabled:opacity-50 ${
        active
          ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] font-semibold'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
      }`}
      title={title}
    >
      <MessageSquare size={14} className='flex-shrink-0 text-[var(--color-text-secondary)]' />
      <span className='min-w-0 flex-1'>
        <span className='block truncate font-medium'>{title}</span>
        <span className='mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] opacity-65'>
          <Clock3 size={10} />
          <span className='truncate'>{time}</span>
        </span>
      </span>
      <span className='text-[10px] opacity-65'>{meta}</span>
    </button>
  );
}

function SectionLabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`mb-2 px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-tertiary)] ${className}`}>
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
  onClick,
}: {
  title: string;
  meta: string;
  active?: boolean;
  inset?: boolean;
  titleText?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className={`mb-1 flex h-8 w-full items-center gap-2 rounded-[var(--radius-control)] px-2 text-left text-[13px] transition-colors ${
      active
        ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)] font-semibold'
        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
    } ${inset ? 'pl-7' : ''}`}
      title={titleText}
    >
      {!inset && <Folder size={14} className='flex-shrink-0 text-[var(--color-text-secondary)]' />}
      <span className='min-w-0 flex-1 truncate'>{title}</span>
      <span className='text-[10px] opacity-70'>{meta}</span>
    </button>
  );
}

function formatSessionTime(value: string, lang: Lang): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return lang === 'zh' ? '刚刚' : 'now';
  if (diff < hour) return lang === 'zh' ? `${Math.floor(diff / minute)} 分钟前` : `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return lang === 'zh' ? `${Math.floor(diff / hour)} 小时前` : `${Math.floor(diff / hour)}h ago`;
  return date.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
  });
}
