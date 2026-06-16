export type ThemeMode = 'light' | 'dark' | 'auto';

const STORAGE_KEY = 'seehtml-theme';

export function getTheme(): ThemeMode {
  return (localStorage.getItem(STORAGE_KEY) as ThemeMode) || 'light';
}

export function setTheme(mode: ThemeMode) {
  localStorage.setItem(STORAGE_KEY, mode);
  applyTheme(mode);
}

export function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  root.classList.remove('theme-light', 'theme-dark');

  if (mode === 'auto') {
    // Follow system preference via CSS media query
    const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.add(isDark ? 'theme-dark' : 'theme-light');
  } else {
    root.classList.add(`theme-${mode}`);
  }
}

// Listen for system theme changes
export function initTheme() {
  const mode = getTheme();
  applyTheme(mode);

  if (mode === 'auto') {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (getTheme() === 'auto') {
        const root = document.documentElement;
        root.classList.remove('theme-light', 'theme-dark');
        root.classList.add(e.matches ? 'theme-dark' : 'theme-light');
      }
    });
  }
}
