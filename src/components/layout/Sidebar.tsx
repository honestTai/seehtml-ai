import { useState, useEffect } from 'react';
import { FileExplorer } from '../file/FileExplorer';
import { getLanguage, setLanguage, useI18n, type Lang } from '../../lib/i18n';
import { getTheme, setTheme, type ThemeMode } from '../../lib/theme';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';

function basename(path: string | null): string {
  if (!path) return 'SeeHTML AI';
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export function Sidebar() {
  const { t } = useI18n();
  const [lang, setLang] = useState<Lang>(getLanguage());
  const [theme, setThemeState] = useState<ThemeMode>(getTheme());
  const clearMessages = useChatStore((s) => s.clearMessages);
  const messages = useChatStore((s) => s.messages);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const projectPath = useUIStore((s) => s.projectPath);
  const setProjectPath = useUIStore((s) => s.setProjectPath);

  useEffect(() => {
    const onLangChange = () => setLang(getLanguage());
    window.addEventListener('languagechange', onLangChange);
    return () => window.removeEventListener('languagechange', onLangChange);
  }, []);

  const openProject = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === 'string') {
        setProjectPath(selected);
      }
    } catch {
      // The file tree below will show any unavailable-runtime state in dev browsers.
    }
  };

  return (
    <aside className='w-80 flex-shrink-0 overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-bg-secondary)] max-lg:h-[360px] max-lg:w-full max-lg:border-b max-lg:border-r-0'>
      <div className='flex h-full min-h-0 flex-col'>
      {/* Language + Theme bar */}
      <div className='flex h-10 items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3'>
        <span className='mr-1 text-[10px] text-[var(--color-text-secondary)]'>SeeHTML AI</span>
        <span className='h-3 w-px bg-[var(--color-border)]' />
        <button onClick={() => { setLanguage('zh'); setLang('zh'); }}
          className={`rounded-lg px-2 py-0.5 text-xs font-medium ${lang==='zh'?'bg-[var(--color-accent)] text-white':'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}>
          {t('lang.zh')}
        </button>
        <button onClick={() => { setLanguage('en'); setLang('en'); }}
          className={`rounded-lg px-2 py-0.5 text-xs font-medium ${lang==='en'?'bg-[var(--color-accent)] text-white':'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}>
          {t('lang.en')}
        </button>
        <span className='flex-1' />
        <button onClick={() => { setTheme('light'); setThemeState('light'); }}
          className={`rounded-lg px-1.5 text-xs ${theme==='light'?'bg-[var(--color-accent)]/20':''}`} title={t('theme.light')}>☀️</button>
        <button onClick={() => { setTheme('dark'); setThemeState('dark'); }}
          className={`rounded-lg px-1.5 text-xs ${theme==='dark'?'bg-[var(--color-accent)]/20':''}`} title={t('theme.dark')}>🌙</button>
        <button onClick={() => { setTheme('auto'); setThemeState('auto'); }}
          className={`rounded-lg px-1.5 text-xs ${theme==='auto'?'bg-[var(--color-accent)]/20':''}`} title={t('theme.auto')}>🖥️</button>
      </div>

      <div className='border-b border-[var(--color-border)] p-3'>
        <div className='mb-2 flex items-center justify-between'>
          <div>
            <div className='text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]'>{t('project.title')}</div>
            <div className='mt-0.5 truncate text-sm font-semibold text-[var(--color-text-primary)]' title={projectPath || undefined}>
              {basename(projectPath)}
            </div>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-[10px] ${isProcessing ? 'bg-[var(--color-warning)]/15 text-[var(--color-warning)]' : 'bg-[var(--color-success)]/15 text-[var(--color-success)]'}`}>
            {isProcessing ? t('status.processing') : t('status.ready')}
          </span>
        </div>
        <button
          onClick={openProject}
          className='w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-3 py-1.5 text-left text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
        >
          + {t('project.open')}
        </button>
      </div>

      <div className='border-b border-[var(--color-border)] p-3'>
        <div className='mb-2 flex items-center justify-between'>
          <div className='text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]'>{t('sessions.title')}</div>
          <button
            onClick={clearMessages}
            className='rounded-lg bg-[var(--color-bg-tertiary)] px-2 py-1 text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
          >
            + {t('sessions.new')}
          </button>
        </div>
        <SessionRow active title={t('sessions.current')} meta={`${messages.length} ${t('chat.messages')}`} />
        <SessionRow title={t('sessions.htmlQuality')} meta='HTML Skill' />
        <SessionRow title={t('sessions.previewExport')} meta='MP4 / PNG' />
      </div>

      <div className='min-h-0 flex-1 overflow-hidden'>
        <FileExplorer />
      </div>
      </div>
    </aside>
  );
}

function SessionRow({ title, meta, active }: { title: string; meta: string; active?: boolean }) {
  return (
    <button className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
      active
        ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]'
        : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
    }`}>
      <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]'}`} />
      <span className='min-w-0 flex-1 truncate'>{title}</span>
      <span className='text-[10px] opacity-70'>{meta}</span>
    </button>
  );
}
