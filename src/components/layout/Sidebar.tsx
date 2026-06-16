import { useState, useEffect } from 'react';
import { FileExplorer } from '../file/FileExplorer';
import { getLanguage, setLanguage, useI18n, type Lang } from '../../lib/i18n';
import { getTheme, setTheme, type ThemeMode } from '../../lib/theme';

export function Sidebar() {
  const { t } = useI18n();
  const [lang, setLang] = useState<Lang>(getLanguage());
  const [theme, setThemeState] = useState<ThemeMode>(getTheme());

  useEffect(() => {
    const onLangChange = () => setLang(getLanguage());
    window.addEventListener('languagechange', onLangChange);
    return () => window.removeEventListener('languagechange', onLangChange);
  }, []);

  return (
    <aside className='w-72 flex-shrink-0 overflow-hidden rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-[var(--shadow-soft)] max-lg:h-48 max-lg:w-full'>
      <div className='flex h-full flex-col'>
      {/* Language + Theme bar */}
      <div className='flex items-center gap-1 border-b border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-2 py-1.5'>
        <span className='text-[10px] text-[var(--color-text-secondary)] mr-1'>🌐</span>
        <button onClick={() => { setLanguage('zh'); setLang('zh'); }}
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${lang==='zh'?'bg-[var(--color-accent)] text-white':'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}>
          {t('lang.zh')}
        </button>
        <button onClick={() => { setLanguage('en'); setLang('en'); }}
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${lang==='en'?'bg-[var(--color-accent)] text-white':'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}>
          {t('lang.en')}
        </button>
        <span className='flex-1' />
        <button onClick={() => { setTheme('light'); setThemeState('light'); }}
          className={`rounded-full px-1.5 text-xs ${theme==='light'?'bg-[var(--color-accent)]/20':''}`} title={t('theme.light')}>☀️</button>
        <button onClick={() => { setTheme('dark'); setThemeState('dark'); }}
          className={`rounded-full px-1.5 text-xs ${theme==='dark'?'bg-[var(--color-accent)]/20':''}`} title={t('theme.dark')}>🌙</button>
        <button onClick={() => { setTheme('auto'); setThemeState('auto'); }}
          className={`rounded-full px-1.5 text-xs ${theme==='auto'?'bg-[var(--color-accent)]/20':''}`} title={t('theme.auto')}>🖥️</button>
      </div>

      {/* Content */}
      <div className='flex-1 min-h-0 overflow-hidden'>
        <FileExplorer />
      </div>
      </div>
    </aside>
  );
}
