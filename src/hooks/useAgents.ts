import { useState, useEffect, useCallback } from 'react';
import type { AgentInfo } from '../types';

export function useAgents() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke('list_agents');
      setAgents(result as AgentInfo[]);
    } catch (e) {
      console.error('Failed to list agents:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { agents, loading, refresh };
}
