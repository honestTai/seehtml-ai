import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

export async function pickExistingProject(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === 'string' ? selected : null;
}

export async function createProjectInSelectedParent(): Promise<string | null> {
  const parentPath = await pickExistingProject();
  if (!parentPath) return null;
  return invoke<string>('create_project_directory', { parentPath, name: null });
}
