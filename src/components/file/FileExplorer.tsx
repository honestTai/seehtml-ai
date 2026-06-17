import { useCallback, useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode2,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  FolderPlus,
  RefreshCw,
} from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import { PREVIEWABLE_EXTENSIONS, getPreviewKind, isPreviewableName, usePreviewStore } from '../../stores/previewStore';
import { useUIStore } from '../../stores/uiStore';
import { useI18n } from '../../lib/i18n';
import { PROJECT_CHANGED_EVENT, joinProjectPath } from '../../lib/projectPaths';
import { createProjectInSelectedParent, pickExistingProject } from '../../lib/workspace';
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

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/g, '');
}

function buildBreadcrumbs(rootPath: string, targetPath: string | undefined, rootLabel: string) {
  const normalizedRoot = normalizePath(rootPath);
  const normalizedTarget = targetPath ? normalizePath(targetPath) : normalizedRoot;
  const safeTarget = normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`)
    ? normalizedTarget
    : normalizedRoot;
  const relative = safeTarget.slice(normalizedRoot.length).replace(/^\/+/, '');
  const parts = relative ? relative.split('/').filter(Boolean) : [];
  const rootName = fileName(rootPath) || rootLabel;
  const crumbs = [{ label: rootName, path: rootPath }];
  let cursor = rootPath;
  for (const part of parts) {
    cursor = joinProjectPath(cursor, part);
    crumbs.push({ label: part, path: cursor });
  }
  return crumbs;
}

function ancestorPaths(rootPath: string, targetPath: string): string[] {
  const normalizedRoot = normalizePath(rootPath);
  const normalizedTarget = normalizePath(targetPath);
  if (normalizedTarget !== normalizedRoot && !normalizedTarget.startsWith(`${normalizedRoot}/`)) {
    return [rootPath];
  }

  const relative = normalizedTarget.slice(normalizedRoot.length).replace(/^\/+/, '');
  const paths = [rootPath];
  let cursor = rootPath;
  for (const part of relative.split('/').filter(Boolean)) {
    cursor = joinProjectPath(cursor, part);
    paths.push(cursor);
  }
  return paths;
}

export function FileExplorer({ showHeader = false }: { showHeader?: boolean } = {}) {
  const { t } = useI18n();
  const setHtmlDocument = useChatStore((s) => s.setHtmlDocument);
  const openPreviewFile = usePreviewStore((s) => s.openFile);
  const activeDoc = usePreviewStore((s) => s.document);
  const projectPath = useUIStore((s) => s.projectPath);
  const setProjectPath = useUIStore((s) => s.setProjectPath);
  const workspaceSelectionPath = useUIStore((s) => s.workspaceSelectionPath);
  const setWorkspaceSelectionPath = useUIStore((s) => s.setWorkspaceSelectionPath);
  const setWorkspaceMode = useUIStore((s) => s.setWorkspaceMode);
  const activePath = workspaceSelectionPath || activeDoc?.path;
  const [root, setRoot] = useState<FileTreeNode | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    if (!projectPath) {
      setRoot(null);
      setExpanded(new Set());
      setError(null);
      setLoading(false);
      return;
    }
    loadRoot(projectPath);
  }, [loadRoot, projectPath]);

  useEffect(() => {
    const handleProjectFilesChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ projectPath?: string }>).detail;
      if (projectPath && (!detail?.projectPath || detail.projectPath === projectPath)) {
        void loadRoot(projectPath);
      }
    };
    window.addEventListener(PROJECT_CHANGED_EVENT, handleProjectFilesChanged);
    return () => window.removeEventListener(PROJECT_CHANGED_EVENT, handleProjectFilesChanged);
  }, [loadRoot, projectPath]);

  useEffect(() => {
    if (!root || !projectPath || !workspaceSelectionPath) return;
    const normalizedRoot = normalizePath(root.path);
    const normalizedSelection = normalizePath(workspaceSelectionPath);
    if (normalizedSelection !== normalizedRoot && !normalizedSelection.startsWith(`${normalizedRoot}/`)) return;

    let cancelled = false;
    void (async () => {
      try {
        const loaded = await loadDirectory(workspaceSelectionPath);
        if (cancelled || !loaded.is_dir) return;
        setRoot((current) => current ? updateNode(current, loaded.path, () => loaded) : loaded);
        setExpanded((prev) => {
          const next = new Set(prev);
          for (const path of ancestorPaths(root.path, loaded.path)) next.add(path);
          return next;
        });
      } catch {
        // Non-directory selections are expected when previewing a file.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadDirectory, projectPath, root?.path, workspaceSelectionPath]);

  const chooseFolder = useCallback(async () => {
    try {
      const selected = await pickExistingProject();
      if (selected) {
        setProjectPath(selected);
        setWorkspaceSelectionPath(selected);
        setWorkspaceMode('preview');
        useChatStore.getState().ensureProjectSession(selected);
        await loadRoot(selected);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('sidebar.unavailable'));
    }
  }, [loadRoot, setProjectPath, setWorkspaceMode, setWorkspaceSelectionPath, t]);

  const createProject = useCallback(async () => {
    try {
      const selected = await createProjectInSelectedParent();
      if (selected) {
        setProjectPath(selected);
        setWorkspaceSelectionPath(selected);
        setWorkspaceMode('preview');
        useChatStore.getState().ensureProjectSession(selected);
        await loadRoot(selected);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('sidebar.unavailable'));
    }
  }, [loadRoot, setProjectPath, setWorkspaceMode, setWorkspaceSelectionPath, t]);

  const openPreviewPath = useCallback(async (path: string) => {
    setWorkspaceSelectionPath(path);
    const doc = await openPreviewFile(path, fileName(path));
    if (doc) {
      setWorkspaceMode(doc.kind === 'video' ? 'mp4' : 'preview');
    }
    if (doc?.kind === 'html' && doc.content) {
      setHtmlDocument(doc.content);
    }
  }, [openPreviewFile, setHtmlDocument, setWorkspaceMode, setWorkspaceSelectionPath]);

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
    setWorkspaceSelectionPath(node.path);
    setWorkspaceMode('files');

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
  }, [expanded, loadDirectory, setWorkspaceMode, setWorkspaceSelectionPath]);

  const openFile = useCallback(async (node: FileTreeNode) => {
    if (!isPreviewableName(node.name)) return;
    await openPreviewPath(node.path);
  }, [openPreviewPath]);

  const openBreadcrumb = useCallback(async (path: string) => {
    setWorkspaceSelectionPath(path);
    if (isPreviewableName(fileName(path))) {
      await openPreviewPath(path);
      return;
    }
    setWorkspaceMode('files');

    try {
      const loaded = await loadDirectory(path);
      setRoot((current) => current ? updateNode(current, path, () => loaded) : loaded);
      setExpanded((prev) => new Set(prev).add(path));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [loadDirectory, openPreviewPath, setWorkspaceMode, setWorkspaceSelectionPath]);

  const pathBreadcrumbs = root
    ? buildBreadcrumbs(root.path, activePath, t('project.breadcrumbRoot')).slice(1)
    : [];
  const breadcrumbs = [
    { label: t('editor.preview') },
    { label: 'MP4' },
    { label: t('project.folderContents'), path: root?.path },
    ...pathBreadcrumbs,
  ];

  return (
    <div className='h-full flex flex-col'>
      {showHeader && (
        <BreadcrumbBar
          crumbs={breadcrumbs}
          onOpen={openBreadcrumb}
          onChooseFile={chooseFile}
          onChooseFolder={chooseFolder}
          onRefresh={() => projectPath && loadRoot(projectPath)}
          canRefresh={Boolean(projectPath)}
        />
      )}

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

      {!loading && !error && !projectPath && (
        <NoProjectState onCreate={createProject} onOpen={chooseFolder} />
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

    </div>
  );
}

function BreadcrumbBar({
  crumbs,
  onOpen,
  onChooseFile,
  onChooseFolder,
  onRefresh,
  canRefresh,
}: {
  crumbs: { label: string; path?: string }[];
  onOpen: (path: string) => void;
  onChooseFile: () => void;
  onChooseFolder: () => void;
  onRefresh: () => void;
  canRefresh: boolean;
}) {
  const { t } = useI18n();
  if (crumbs.length === 0) return null;

  return (
    <div className='flex h-14 flex-shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3'>
      <nav className='flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-sm' aria-label='breadcrumb'>
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          const isClickable = Boolean(crumb.path);
          return (
            <div key={`${crumb.path}-${index}`} className={`flex min-w-0 items-center gap-1 ${isLast ? 'flex-1' : 'flex-shrink-0'}`}>
              {index > 0 && <ChevronRight size={14} className='flex-shrink-0 text-[var(--color-text-secondary)]/65' />}
              <button
                onClick={() => crumb.path && onOpen(crumb.path)}
                disabled={!isClickable}
                title={crumb.path || crumb.label}
                className={`min-w-0 truncate rounded-[var(--radius-control)] px-1 py-0.5 text-left disabled:cursor-default ${
                  isLast
                    ? 'bg-[var(--color-bg-tertiary)] px-2 font-semibold text-[var(--color-text-primary)]'
                    : isClickable
                    ? 'font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
                    : 'font-medium text-[var(--color-text-secondary)]'
                }`}
              >
                {crumb.label}
              </button>
            </div>
          );
        })}
      </nav>
      <div className='flex flex-shrink-0 items-center gap-1.5'>
        <button
          onClick={onChooseFile}
          title={t('sidebar.openFile')}
          className='inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)]'
        >
          <FileText size={15} />
        </button>
        <button
          onClick={onChooseFolder}
          title={t('sidebar.chooseFolder')}
          className='inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)]'
        >
          <FolderOpen size={15} />
        </button>
        <button
          onClick={onRefresh}
          disabled={!canRefresh}
          title={t('sidebar.refresh')}
          className='inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-border)] disabled:opacity-35'
        >
          <RefreshCw size={15} />
        </button>
      </div>
    </div>
  );
}

function NoProjectState({ onCreate, onOpen }: { onCreate: () => void; onOpen: () => void }) {
  const { t } = useI18n();

  return (
    <div className='flex flex-1 items-center justify-center px-4 py-6'>
      <div className='w-full max-w-[220px] text-center'>
        <div className='mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] text-[var(--color-accent)]'>
          <FolderPlus size={19} />
        </div>
        <div className='text-sm font-semibold text-[var(--color-text-primary)]'>{t('project.noProject')}</div>
        <div className='mt-3 grid gap-2'>
          <button
            onClick={onCreate}
            className='inline-flex h-8 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-accent)] px-3 text-xs font-medium text-white hover:bg-[var(--color-accent-hover)]'
          >
            <FolderPlus size={14} />
            {t('project.new')}
          </button>
          <button
            onClick={onOpen}
            className='inline-flex h-8 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]'
          >
            <FolderOpen size={14} />
            {t('project.open')}
          </button>
        </div>
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
  const TypeIcon = node.is_dir
    ? isExpanded ? FolderOpen : Folder
    : kind === 'html' ? FileCode2
    : kind === 'video' ? FileVideo
    : kind === 'pdf' || kind === 'markdown' ? FileText
    : kind === 'image' ? FileImage
    : File;

  return (
    <div className='px-1'>
      <button
        onClick={() => node.is_dir ? onToggle(node) : onOpenFile(node)}
        disabled={!clickable || disabled}
        className={`flex h-8 w-full items-center gap-1.5 rounded-[var(--radius-control)] pr-2 text-left text-xs transition-colors ${
          active
            ? 'bg-[var(--color-bg-tertiary)] text-[var(--color-text-primary)]'
            : clickable
            ? 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-tertiary)]'
            : 'cursor-default text-[var(--color-text-secondary)]/55'
        } disabled:opacity-50`}
        style={{ paddingLeft: `${Math.min(depth * 14 + 8, 72)}px` }}
        title={node.path}
      >
        <span className={`flex h-4 w-4 items-center justify-center text-[var(--color-text-secondary)]`}>
          {node.is_dir ? (
            isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />
          ) : (
            <span className='h-1 w-1 rounded-full bg-current opacity-50' />
          )}
        </span>
        <TypeIcon size={15} className='flex-shrink-0' />
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
