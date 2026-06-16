import { create } from 'zustand';

interface UIState {
  sidebarOpen: boolean;
  sidebarTab: string;
  commandPaletteOpen: boolean;
  theme: string;
  projectPath: string | null;
  toggleSidebar: () => void;
  setSidebarTab: (tab: string) => void;
  toggleCommandPalette: () => void;
  setTheme: (theme: string) => void;
  setProjectPath: (path: string | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  sidebarTab: "files",
  commandPaletteOpen: false,
  theme: "dark",
  projectPath: null,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  setTheme: (theme) => set({ theme }),
  setProjectPath: (projectPath) => set({ projectPath }),
}));
