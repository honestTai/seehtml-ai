import React, { useEffect } from 'react';
import { AppShell } from './components/layout/AppShell';
import { Sidebar } from './components/layout/Sidebar';
import { EditorPanel } from './components/editor/EditorPanel';
import { ChatPanel } from './components/chat/ChatPanel';
import { StatusBar } from './components/layout/StatusBar';
import { CommandPalette } from './components/chat/CommandPalette';
import { ModelSettingsDialog } from './components/settings/ModelSettingsDialog';
import { useChatStore } from './stores/chatStore';
import { useUIStore } from './stores/uiStore';

export default function App() {
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen);

  useEffect(() => {
    void useChatStore.getState().hydrateMemory();

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === "k") {
        e.preventDefault();
        useUIStore.getState().toggleCommandPalette();
        return;
      }
      if (isEditableTarget(e.target)) return;
      if ((e.metaKey || e.ctrlKey) && key === "b") {
        e.preventDefault();
        useUIStore.getState().toggleSidebar();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-[var(--color-bg-primary)] text-[var(--color-text-primary)]">
      <a href="#workspace-main" className="skip-link">Skip to Workspace</a>
      <AppShell>
        <Sidebar />
        <main id="workspace-main" className="flex min-w-0 flex-1 overflow-hidden max-[900px]:flex-col">
          <EditorPanel />
          <ChatPanel />
        </main>
      </AppShell>
      <StatusBar />
      {commandPaletteOpen && <CommandPalette />}
      <ModelSettingsDialog />
    </div>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}
