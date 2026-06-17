import { create } from 'zustand';

const PROJECT_STORAGE_KEY = 'seehtml-project-path';

export type WorkspaceMode = 'preview' | 'mp4' | 'files';

interface UIState {
  sidebarOpen: boolean;
  sidebarTab: string;
  commandPaletteOpen: boolean;
  theme: string;
  projectPath: string | null;
  workspaceSelectionPath: string | null;
  workspaceMode: WorkspaceMode;
  toggleSidebar: () => void;
  setSidebarTab: (tab: string) => void;
  toggleCommandPalette: () => void;
  setTheme: (theme: string) => void;
  setProjectPath: (path: string | null) => void;
  setWorkspaceSelectionPath: (path: string | null) => void;
  setWorkspaceMode: (mode: WorkspaceMode) => void;
}

function loadProjectPath(): string | null {
  try {
    const saved = localStorage.getItem(PROJECT_STORAGE_KEY);
    return saved && saved.trim() ? saved : null;
  } catch {
    return null;
  }
}

function persistProjectPath(path: string | null): void {
  try {
    if (path) {
      localStorage.setItem(PROJECT_STORAGE_KEY, path);
    } else {
      localStorage.removeItem(PROJECT_STORAGE_KEY);
    }
  } catch {}
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  sidebarTab: "files",
  commandPaletteOpen: false,
  theme: "dark",
  projectPath: loadProjectPath(),
  workspaceSelectionPath: null,
  workspaceMode: 'preview',
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  setTheme: (theme) => set({ theme }),
  setProjectPath: (projectPath) => {
    persistProjectPath(projectPath);
    set({ projectPath, workspaceSelectionPath: projectPath, workspaceMode: 'preview' });
  },
  setWorkspaceSelectionPath: (workspaceSelectionPath) => set({ workspaceSelectionPath }),
  setWorkspaceMode: (workspaceMode) => set({ workspaceMode }),
}));
