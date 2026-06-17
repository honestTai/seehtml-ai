export const PROJECT_CHANGED_EVENT = 'seehtml:project-files-changed';

function separatorFor(root: string): string {
  return root.includes('\\') ? '\\' : '/';
}

export function joinProjectPath(root: string, ...parts: string[]): string {
  const sep = separatorFor(root);
  const cleanRoot = root.replace(/[\\/]+$/, '');
  const cleanParts = parts
    .map((part) => part.replace(/^[\\/]+|[\\/]+$/g, ''))
    .filter(Boolean);
  return [cleanRoot, ...cleanParts].join(sep);
}

export function projectHtmlPath(projectPath: string): string {
  return joinProjectPath(projectPath, 'index.html');
}

export function projectExportDir(projectPath: string): string {
  return joinProjectPath(projectPath, 'exports');
}

export function projectFramesDir(projectPath: string): string {
  return joinProjectPath(projectPath, 'exports', 'frames');
}

export function projectExportPath(projectPath: string, fileName: string): string {
  return joinProjectPath(projectPath, 'exports', fileName);
}

export function notifyProjectFilesChanged(projectPath: string): void {
  window.dispatchEvent(new CustomEvent(PROJECT_CHANGED_EVENT, { detail: { projectPath } }));
}
