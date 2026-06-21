import { create } from 'zustand';

const PROJECT_STORAGE_KEY = 'seehtml-project-path';
const CHAT_PANEL_WIDTH_KEY = 'seehtml-chat-panel-width';
const DEFAULT_CHAT_PANEL_WIDTH = 410;
const MIN_CHAT_PANEL_WIDTH = 340;
const MAX_CHAT_PANEL_WIDTH = 720;

export type WorkspaceMode = 'files' | 'preview' | 'mp4';

interface UIState {
  sidebarOpen: boolean;
  sidebarTab: string;
  commandPaletteOpen: boolean;
  modelSettingsOpen: boolean;
  theme: string;
  projectPath: string | null;
  workspaceSelectionPath: string | null;
  workspaceMode: WorkspaceMode;
  chatPanelWidth: number;
  toggleSidebar: () => void;
  setSidebarTab: (tab: string) => void;
  toggleCommandPalette: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setModelSettingsOpen: (open: boolean) => void;
  setTheme: (theme: string) => void;
  setProjectPath: (path: string | null) => void;
  setWorkspaceSelectionPath: (path: string | null) => void;
  setWorkspaceMode: (mode: WorkspaceMode) => void;
  setChatPanelWidth: (width: number) => void;
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

function loadChatPanelWidth(): number {
  try {
    const raw = Number(localStorage.getItem(CHAT_PANEL_WIDTH_KEY));
    return clampChatPanelWidth(Number.isFinite(raw) ? raw : DEFAULT_CHAT_PANEL_WIDTH);
  } catch {
    return DEFAULT_CHAT_PANEL_WIDTH;
  }
}

function persistChatPanelWidth(width: number): void {
  try {
    localStorage.setItem(CHAT_PANEL_WIDTH_KEY, String(width));
  } catch {}
}

export function clampChatPanelWidth(width: number): number {
  return Math.max(MIN_CHAT_PANEL_WIDTH, Math.min(MAX_CHAT_PANEL_WIDTH, Math.round(width)));
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  sidebarTab: "files",
  commandPaletteOpen: false,
  modelSettingsOpen: false,
  theme: "light",
  projectPath: loadProjectPath(),
  workspaceSelectionPath: null,
  workspaceMode: 'files',
  chatPanelWidth: loadChatPanelWidth(),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
  setModelSettingsOpen: (modelSettingsOpen) => set({ modelSettingsOpen }),
  setTheme: (theme) => set({ theme }),
  setProjectPath: (projectPath) => {
    persistProjectPath(projectPath);
    set({ projectPath, workspaceSelectionPath: projectPath, workspaceMode: 'files' });
  },
  setWorkspaceSelectionPath: (workspaceSelectionPath) => set({ workspaceSelectionPath }),
  setWorkspaceMode: (workspaceMode) => set({ workspaceMode }),
  setChatPanelWidth: (width) => {
    const next = clampChatPanelWidth(width);
    persistChatPanelWidth(next);
    set({ chatPanelWidth: next });
  },
}));
