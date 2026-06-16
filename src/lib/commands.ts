export const COMMANDS = [
  { id: 'open', label: 'Open HTML File', icon: '📂', desc: 'Open and parse an HTML document', params: ['path'] },
  { id: 'export', label: 'Export Document', icon: '📦', desc: 'Export to PPTX, Markdown, or PNG', params: ['format'] },
  { id: 'ai', label: 'AI Generate', icon: '🤖', desc: 'Generate slide content with AI', params: ['topic'] },
  { id: 'theme', label: 'Apply Theme', icon: '🎨', desc: 'Change presentation theme and style', params: ['name'] },
  { id: 'publish', label: 'Publish Package', icon: '🚀', desc: 'Package document for sharing', params: [] },
  { id: 'media', label: 'Process Media', icon: '🎬', desc: 'Add video, audio, or subtitles', params: ['path'] },
] as const;

export type CommandId = typeof COMMANDS[number]['id'];
