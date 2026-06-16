export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

export function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export function getAgentEmoji(agent: string): string {
  const map: Record<string, string> = {
    Orchestrator: '🎯', Document: '📄', Content: '🤖',
    Style: '🎨', Media: '🎬', Export: '📦', Publish: '🚀',
  };
  return map[agent] || '🔹';
}
