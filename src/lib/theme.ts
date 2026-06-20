export type ThemeMode = 'light' | 'dark' | 'auto';

const STORAGE_KEY = 'seehtml-theme';
export const THEME_CHANGE_EVENT = 'seehtml-themechange';
let themeListenerAttached = false;

export function getTheme(): ThemeMode {
  return (localStorage.getItem(STORAGE_KEY) as ThemeMode) || 'light';
}

export function setTheme(mode: ThemeMode) {
  localStorage.setItem(STORAGE_KEY, mode);
  applyTheme(mode);
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: mode }));
}

export function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  root.classList.remove('theme-light', 'theme-dark');
  const resolvedMode = resolveThemeMode(mode);
  root.classList.add(`theme-${resolvedMode}`);
  root.style.colorScheme = resolvedMode;
  syncThemeColor(resolvedMode);
}

function resolveThemeMode(mode: ThemeMode): Exclude<ThemeMode, 'auto'> {
  if (mode !== 'auto') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function syncThemeColor(mode: Exclude<ThemeMode, 'auto'>) {
  const color = mode === 'dark' ? '#0f141c' : '#f6f8fb';
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = color;
}

export function initTheme() {
  const mode = getTheme();
  applyTheme(mode);

  if (themeListenerAttached) return;
  themeListenerAttached = true;
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getTheme() === 'auto') applyTheme('auto');
  });
}
