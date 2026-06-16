import { useState, useCallback } from 'react';
import type { DocumentInfo } from '../types';

export function useDocument() {
  const [doc, setDoc] = useState<DocumentInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const openDocument = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke('open_html_file', { path });
      const info = typeof result === 'object' && result !== null
        ? (Array.isArray(result) ? result[0] : result) as unknown as DocumentInfo
        : null;
      setDoc(info);
      return info;
    } finally {
      setLoading(false);
    }
  }, []);

  const getInfo = useCallback(async (html: string) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke('get_document_info', { htmlContent: html });
    } catch (e) {
      console.error('Failed to get document info:', e);
      return null;
    }
  }, []);

  return { doc, loading, openDocument, getInfo };
}
