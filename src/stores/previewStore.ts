import { create } from 'zustand';

export type PreviewKind = 'html' | 'video' | 'pdf' | 'markdown' | 'image';
export type PreviewSource = 'file' | 'generated';

export interface PreviewDocument {
  name: string;
  kind: PreviewKind;
  source: PreviewSource;
  path?: string;
  url?: string;
  mime?: string;
  content?: string;
}

export interface PreviewRenderRequest {
  id: string;
  type: 'mp4';
  pageCount?: number;
  reason: string;
}

export interface PreviewRenderStatus {
  state: 'queued' | 'running' | 'done' | 'error';
  message: string;
  outputPath?: string;
  updatedAt: string;
}

interface PreviewState {
  document: PreviewDocument | null;
  renderRequest: PreviewRenderRequest | null;
  renderStatus: PreviewRenderStatus | null;
  isLoading: boolean;
  error: string | null;
  openFile: (path: string, name?: string) => Promise<PreviewDocument | null>;
  setGeneratedHtml: (html: string, name?: string) => void;
  requestRender: (request: Omit<PreviewRenderRequest, 'id'>) => void;
  clearRenderRequest: (id?: string) => void;
  setRenderStatus: (status: Omit<PreviewRenderStatus, 'updatedAt'> | null) => void;
  clear: () => void;
}

const textPreviewKinds = new Set<PreviewKind>(['html', 'markdown']);
const inlineBinaryPreviewKinds = new Set<PreviewKind>(['image', 'pdf']);

export const PREVIEWABLE_EXTENSIONS = [
  'html', 'htm', 'xhtml',
  'mp4', 'webm', 'ogg', 'mov', 'm4v',
  'pdf',
  'md', 'markdown',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp',
];

export function getPreviewKind(name: string): PreviewKind | null {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['html', 'htm', 'xhtml'].includes(ext)) return 'html';
  if (['mp4', 'webm', 'ogg', 'mov', 'm4v'].includes(ext)) return 'video';
  if (ext === 'pdf') return 'pdf';
  if (['md', 'markdown'].includes(ext)) return 'markdown';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return 'image';
  return null;
}

export function isPreviewableName(name: string): boolean {
  return getPreviewKind(name) !== null;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface BinaryPreviewPayload {
  name: string;
  mime: string;
  data_url: string;
  size: number;
}

export const usePreviewStore = create<PreviewState>((set) => ({
  document: null,
  renderRequest: null,
  renderStatus: null,
  isLoading: false,
  error: null,

  openFile: async (path, providedName) => {
    const name = providedName || fileName(path);
    const kind = getPreviewKind(name);
    if (!kind) {
      const message = 'This file type is not previewable.';
      set({ error: message, isLoading: false });
      return null;
    }

    set({ isLoading: true, error: null });
    try {
      let doc: PreviewDocument;

      if (textPreviewKinds.has(kind)) {
        const { convertFileSrc, invoke } = await import('@tauri-apps/api/core');
        const content = await invoke<string>('read_text_file', { path });
        doc = { name, path, kind, source: 'file', content, url: kind === 'html' ? convertFileSrc(path) : undefined };
      } else if (inlineBinaryPreviewKinds.has(kind)) {
        const { invoke } = await import('@tauri-apps/api/core');
        const payload = await invoke<BinaryPreviewPayload>('read_binary_preview', { path });
        doc = { name: payload.name || name, path, kind, source: 'file', url: payload.data_url, mime: payload.mime };
      } else {
        const { convertFileSrc } = await import('@tauri-apps/api/core');
        doc = { name, path, kind, source: 'file', url: convertFileSrc(path) };
      }

      set({ document: doc, isLoading: false, error: null });
      return doc;
    } catch (error) {
      const message = errorMessage(error);
      set({ isLoading: false, error: message });
      return null;
    }
  },

  setGeneratedHtml: (html, name = 'AI HTML Preview') => {
    set({
      document: { name, kind: 'html', source: 'generated', content: html },
      isLoading: false,
      error: null,
    });
  },

  requestRender: (request) => {
    set({
      renderRequest: { ...request, id: crypto.randomUUID() },
      renderStatus: {
        state: 'queued',
        message: 'MP4 已加入后台渲染队列',
        updatedAt: new Date().toISOString(),
      },
    });
  },

  clearRenderRequest: (id) => {
    set((state) => {
      if (id && state.renderRequest?.id !== id) return {};
      return { renderRequest: null };
    });
  },

  setRenderStatus: (status) => {
    set({
      renderStatus: status
        ? { ...status, updatedAt: new Date().toISOString() }
        : null,
    });
  },

  clear: () => set({ document: null, renderRequest: null, renderStatus: null, isLoading: false, error: null }),
}));
