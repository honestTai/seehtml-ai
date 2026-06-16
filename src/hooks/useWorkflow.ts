import { useState, useCallback } from 'react';
import type { WorkflowStep } from '../types';

export function useWorkflow() {
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [running, setRunning] = useState(false);

  const execute = useCallback(async (command: string, params?: Record<string, unknown>) => {
    setRunning(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke('run_workflow', { command, params: params || {} });
      setSteps(result as WorkflowStep[]);
      return result as WorkflowStep[];
    } finally {
      setRunning(false);
    }
  }, []);

  const exportDocument = useCallback(async (html: string, format: string, theme?: Record<string, unknown>) => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke('export_document', { html, format, theme, outputPath: null });
    } catch (e) {
      console.error('Export failed:', e);
      return null;
    }
  }, []);

  return { steps, running, execute, exportDocument };
}
