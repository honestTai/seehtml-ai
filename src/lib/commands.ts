export const COMMANDS = [
  { id: 'open', label: 'Open HTML File', icon: 'folder', desc: 'Open an HTML document or project file', params: ['path'] },
  { id: 'ai', label: 'Generate HTML', icon: 'bot', desc: 'Generate or edit previewable HTML with AI', params: ['topic'] },
  { id: 'export', label: 'Export PPT / MP4', icon: 'export', desc: 'Export the current HTML to PowerPoint or MP4', params: ['format'] },
] as const;

export type CommandId = typeof COMMANDS[number]['id'];
