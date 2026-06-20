import { create } from 'zustand';
import { getLanguage, t } from '../lib/i18n';
import {
  getMp4ExportProfile,
  mp4ProfileOptionLabel,
  type Mp4ExportProfileId,
} from '../lib/mp4ExportProfiles';

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
  profileId: Mp4ExportProfileId;
  frameRate: number;
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
  requestRender: (request: PreviewRenderInput) => void;
  clearRenderRequest: (id?: string) => void;
  setRenderStatus: (status: Omit<PreviewRenderStatus, 'updatedAt'> | null) => void;
  clear: () => void;
}

type PreviewRenderInput =
  Omit<PreviewRenderRequest, 'id' | 'profileId' | 'frameRate'>
  & Partial<Pick<PreviewRenderRequest, 'profileId' | 'frameRate'>>;

const textPreviewKinds = new Set<PreviewKind>(['html', 'markdown']);
const inlineBinaryPreviewKinds = new Set<PreviewKind>(['image', 'pdf']);
const htmlExtensions = new Set(['html', 'htm', 'xhtml']);
const videoExtensions = new Set(['mp4', 'webm', 'ogg', 'mov', 'm4v']);
const markdownExtensions = new Set(['md', 'markdown']);
const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

export const PREVIEWABLE_EXTENSIONS = [
  'html', 'htm', 'xhtml',
  'mp4', 'webm', 'ogg', 'mov', 'm4v',
  'pdf',
  'md', 'markdown',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp',
];

export function getPreviewKind(name: string): PreviewKind | null {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (htmlExtensions.has(ext)) return 'html';
  if (videoExtensions.has(ext)) return 'video';
  if (ext === 'pdf') return 'pdf';
  if (markdownExtensions.has(ext)) return 'markdown';
  if (imageExtensions.has(ext)) return 'image';
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
    const profile = getMp4ExportProfile(request.profileId);
    const frameRate = request.frameRate || profile.fps;
    set({
      renderRequest: {
        ...request,
        profileId: profile.id,
        frameRate,
        id: crypto.randomUUID(),
      },
      renderStatus: {
        state: 'queued',
        message: `${t('export.mp4Queued')} · ${mp4ProfileOptionLabel(profile, getLanguage())}`,
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
