import { useCallback, useEffect, useRef, useState } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { PREVIEWABLE_EXTENSIONS, getPreviewKind, isPreviewableName, usePreviewStore } from '../../stores/previewStore';
import { useUIStore } from '../../stores/uiStore';
import { useI18n } from '../../lib/i18n';
import type { FileTreeNode } from '../../types';

function updateNode(
  node: FileTreeNode,
  path: string,
  updater: (node: FileTreeNode) => FileTreeNode,
): FileTreeNode {
  if (node.path === path) return updater(node);
  if (!node.children) return node;
  return {
    ...node,
    children: node.children.map((child) => updateNode(child, path, updater)),
  };
}

function sortKey(node: FileTreeNode): string {
  return `${node.is_dir ? '0' : '1'}:${node.name.toLowerCase()}`;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

export function FileExplorer() {
  const { t } = useI18n();
  const setHtmlDocument = useChatStore((s) => s.setHtmlDocument);
  const openPreviewFile = usePreviewStore((s) => s.openFile);
  const activePath = usePreviewStore((s) => s.document?.path);
  const projectPath = useUIStore((s) => s.projectPath);
  const setProjectPath = useUIStore((s) => s.setProjectPath);
  const [root, setRoot] = useState<FileTreeNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const autoPreviewedProjectRef = useRef<string | null>(null);

  const loadDirectory = useCallback(async (path?: string | null) => {
    const tauriWindow = window as unknown as { __TAURI_INTERNALS__?: unknown };
    if (!tauriWindow.__TAURI_INTERNALS__) {
      throw new Error(t('sidebar.unavailable'));
    }
    const { invoke } = await import('@tauri-apps/api/core');
    if (typeof invoke !== 'function') {
      throw new Error(t('sidebar.unavailable'));
    }
    const node = await invoke<FileTreeNode>('list_directory', { path: path ?? null });
    if (node.children) {
      node.children = [...node.children].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    }
    return node;
  }, [t]);

  const loadRoot = useCallback(async (path?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const node = await loadDirectory(path);
      setRoot(node);
      setExpanded(new Set([node.path]));
    } catch (e) {
      setRoot(null);
      setError(e instanceof Error ? e.message : t('sidebar.unavailable'));
    } finally {
      setLoading(false);
    }
  }, [loadDirectory, t]);

  useEffect(() => {
    loadRoot(projectPath);
  }, [loadRoot, projectPath]);

  const chooseFolder = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, multiple: false });
      if (typeof selected === 'string') {
        setProjectPath(selected);
        await loadRoot(selected);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('sidebar.unavailable'));
    }
  }, [loadRoot, setProjectPath, t]);

  const openPreviewPath = useCallback(async (path: string) => {
    const doc = await openPreviewFile(path, fileName(path));
    if (doc?.kind === 'html' && doc.content) {
      setHtmlDocument(doc.content);
    }
  }, [openPreviewFile, setHtmlDocument]);

  useEffect(() => {
    if (!projectPath || autoPreviewedProjectRef.current === projectPath) return;
    autoPreviewedProjectRef.current = projectPath;

    let cancelled = false;
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const entry = await invoke<string | null>('find_project_entry', { path: projectPath });
        if (!cancelled && entry) {
          await openPreviewPath(entry);
        }
      } catch {
        // The tree itself remains usable even if no default preview can be resolved.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openPreviewPath, projectPath]);

  useEffect(() => {
    if (projectPath || !root?.path || autoPreviewedProjectRef.current === root.path) return;
    autoPreviewedProjectRef.current = root.path;

    let cancelled = false;
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const entry = await invoke<string | null>('find_project_entry', { path: root.path });
        if (!cancelled && entry) {
          await openPreviewPath(entry);
        }
      } catch {
        // No default entry is fine; users can still choose a file manually.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openPreviewPath, projectPath, root?.path]);

  const chooseFile = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: false,
        multiple: false,
        filters: [{ name: 'HTML / Video / PDF / Markdown / Image', extensions: PREVIEWABLE_EXTENSIONS }],
      });
      if (typeof selected === 'string') {
        await openPreviewPath(selected);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('sidebar.unavailable'));
    }
  }, [openPreviewPath, t]);

  const toggleDirectory = useCallback(async (node: FileTreeNode) => {
    if (!node.is_dir) return;

    if (expanded.has(node.path)) {
      const next = new Set(expanded);
      next.delete(node.path);
      setExpanded(next);
      return;
    }

    if (node.loaded) {
      setExpanded((prev) => new Set(prev).add(node.path));
      return;
    }

    try {
      const loaded = await loadDirectory(node.path);
      setRoot((current) => current ? updateNode(current, node.path, () => loaded) : current);
      setExpanded((prev) => new Set(prev).add(node.path));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [expanded, loadDirectory]);

  const openFile = useCallback(async (node: FileTreeNode) => {
    if (!isPreviewableName(node.name)) return;
    await openPreviewPath(node.path);
  }, [openPreviewPath]);

  return (
    <div className='h-full flex flex-col'>
      <div className='flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2'>
        <div className='min-w-0 flex-1'>
          <div className='text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]'>
            {t('sidebar.fileTree')}
          </div>
          <div className='text-[11px] text-[var(--color-text-secondary)] truncate' title={root?.path}>
            {root?.name || t('sidebar.workspace')}
          </div>
        </div>
        <button
          onClick={chooseFile}
          title={t('sidebar.openFile')}
          className='h-7 w-7 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] text-xs hover:bg-[var(--color-border)]'
        >
          ◇
        </button>
        <button
          onClick={chooseFolder}
          title={t('sidebar.chooseFolder')}
          className='h-7 w-7 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] text-xs hover:bg-[var(--color-border)]'
        >
          📁
        </button>
        <button
          onClick={() => loadRoot(root?.path)}
          title={t('sidebar.refresh')}
          className='h-7 w-7 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] text-xs hover:bg-[var(--color-border)]'
        >
          ↻
        </button>
      </div>

      {loading && (
        <div className='px-3 py-3 text-xs text-[var(--color-text-secondary)]'>
          {t('sidebar.loading')}
        </div>
      )}

      {!loading && error && (
        <div className='px-3 py-3 text-xs text-[var(--color-danger)] leading-relaxed'>
          {error}
        </div>
      )}

      {!loading && !error && root && (
        <div className='flex-1 min-h-0 overflow-auto py-1'>
          <TreeNode
            node={root}
            depth={0}
            expanded={expanded}
            onToggle={toggleDirectory}
            onOpenFile={openFile}
            disabled={false}
            activePath={activePath}
          />
        </div>
      )}

      {!loading && !error && root && (!root.children || root.children.length === 0) && (
        <div className='px-3 py-3 text-xs text-[var(--color-text-secondary)]'>
          {t('sidebar.empty')}
        </div>
      )}

      <div className='px-3 py-2 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-secondary)]/70'>
        {t('sidebar.hiddenHeavy')}
      </div>
    </div>
  );
}

function TreeNode({
  node,
  depth,
  expanded,
  onToggle,
  onOpenFile,
  disabled,
  activePath,
}: {
  node: FileTreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (node: FileTreeNode) => void;
  onOpenFile: (node: FileTreeNode) => void;
  disabled: boolean;
  activePath?: string;
}) {
  const isExpanded = expanded.has(node.path);
  const kind = getPreviewKind(node.name);
  const clickable = node.is_dir || Boolean(kind);
  const active = activePath === node.path;
  const icon = node.is_dir ? (isExpanded ? '▾' : '▸') : kind ? '◇' : '·';
  const fileIcon = node.is_dir ? '📁'
    : kind === 'html' ? '🌐'
    : kind === 'video' ? '🎬'
    : kind === 'pdf' ? '📕'
    : kind === 'markdown' ? '📝'
    : kind === 'image' ? '🖼️'
    : '📄';

  return (
    <div className='px-1'>
      <button
        onClick={() => node.is_dir ? onToggle(node) : onOpenFile(node)}
        disabled={!clickable || disabled}
        className={`flex h-8 w-full items-center gap-1.5 rounded-xl pr-2 text-left text-xs transition-colors ${
          active
            ? 'bg-[var(--color-accent)] text-white shadow-sm'
            : clickable
            ? 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]'
            : 'cursor-default text-[var(--color-text-secondary)]/55'
        } disabled:opacity-50`}
        style={{ paddingLeft: `${Math.min(depth * 14 + 8, 72)}px` }}
        title={node.path}
      >
        <span className={`w-3 text-[10px] ${active ? 'text-white/80' : 'text-[var(--color-text-secondary)]'}`}>
          {icon}
        </span>
        <span className='text-sm'>{fileIcon}</span>
        <span className='truncate'>{node.name}</span>
      </button>

      {node.is_dir && isExpanded && node.children?.map((child) => (
        <TreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          expanded={expanded}
          onToggle={onToggle}
          onOpenFile={onOpenFile}
          disabled={disabled}
          activePath={activePath}
        />
      ))}
    </div>
  );
}
