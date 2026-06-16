import React, { useEffect } from 'react';
import { AppShell } from './components/layout/AppShell';
import { ActivityRail } from './components/layout/ActivityRail';
import { Sidebar } from './components/layout/Sidebar';
import { EditorPanel } from './components/editor/EditorPanel';
import { ChatPanel } from './components/chat/ChatPanel';
import { StatusBar } from './components/layout/StatusBar';
import { CommandPalette } from './components/chat/CommandPalette';
import { useUIStore } from './stores/uiStore';
import { useChatStore } from './stores/chatStore';

export default function App() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        useUIStore.getState().toggleCommandPalette();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        useUIStore.getState().toggleSidebar();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-[var(--color-bg-primary)]">
      <AppShell>
        <ActivityRail />
        {sidebarOpen && <Sidebar />}
        <ChatPanel />
        <EditorPanel />
      </AppShell>
      <StatusBar />
      {commandPaletteOpen && <CommandPalette />}
    </div>
  );
}
