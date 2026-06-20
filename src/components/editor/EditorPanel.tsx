import ReactMarkdown from 'react-markdown';
import { useState, useCallback, useEffect, useRef } from 'react';
import { AlertCircle, ChevronRight, FileQuestion, FileText, FolderOpen, Loader2, RefreshCw, VideoOff } from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import { PREVIEWABLE_EXTENSIONS, usePreviewStore, type PreviewDocument } from '../../stores/previewStore';
import { HtmlPreview } from './HtmlPreview';
import { useI18n } from '../../lib/i18n';
import { FileExplorer } from '../file/FileExplorer';
import { joinProjectPath, notifyProjectFilesChanged, projectExportPath, projectHtmlPath } from '../../lib/projectPaths';
import { pickExistingProject } from '../../lib/workspace';
import { useUIStore, type WorkspaceMode } from '../../stores/uiStore';

interface WorkspaceBreadcrumbItem {
  label: string;
  mode: WorkspaceMode;
  path?: string;
}

export function EditorPanel() {
  const { t } = useI18n();
  const [currentSlide, setCurrentSlide] = useState(0);
  const [, setCapturedImages] = useState<string[]>([]);
  const htmlDoc = useChatStore((s) => s.htmlDocument);
  const previewDocument = usePreviewStore((s) => s.document);
  const openPreviewFile = usePreviewStore((s) => s.openFile);
  const renderStatus = usePreviewStore((s) => s.renderStatus);
  const isLoading = usePreviewStore((s) => s.isLoading);
  const error = usePreviewStore((s) => s.error);
  const projectPath = useUIStore((s) => s.projectPath);
  const setProjectPath = useUIStore((s) => s.setProjectPath);
  const workspaceSelectionPath = useUIStore((s) => s.workspaceSelectionPath);
  const setWorkspaceSelectionPath = useUIStore((s) => s.setWorkspaceSelectionPath);
  const workspaceMode = useUIStore((s) => s.workspaceMode);
  const setWorkspaceMode = useUIStore((s) => s.setWorkspaceMode);
  const autoOpenedProjectRef = useRef<string | null>(null);

  const activeDoc = previewDocument || (htmlDoc
    ? { name: t('preview.generatedHtml'), kind: 'html' as const, source: 'generated' as const, content: htmlDoc }
    : null);
  const activeDocKey = activeDoc?.path || activeDoc?.name || activeDoc?.content?.slice(0, 64) || '';

  const handleCapture = useCallback((dataUrl: string, index: number) => {
    setCapturedImages((prev) => {
      const next = [...prev];
      next[index] = dataUrl;
      return next;
    });
  }, []);

  const chooseFile = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: false,
        multiple: false,
        filters: [{ name: 'HTML / Video / PDF / Markdown / Image', extensions: PREVIEWABLE_EXTENSIONS }],
      });
      if (typeof selected !== 'string') return;
      setWorkspaceSelectionPath(selected);
      const doc = await openPreviewFile(selected, fileName(selected));
      if (doc) {
        setWorkspaceMode(doc.kind === 'video' ? 'mp4' : 'preview');
      }
      if (doc?.kind === 'html' && doc.content) {
        useChatStore.getState().setHtmlDocument(doc.content);
      }
    } catch {
      // The preview store surfaces file-open errors when the desktop runtime is unavailable.
    }
  }, [openPreviewFile, setWorkspaceMode, setWorkspaceSelectionPath]);

  const chooseFolder = useCallback(async () => {
    try {
      const selected = await pickExistingProject();
      if (!selected) return;
      setProjectPath(selected);
      setWorkspaceSelectionPath(selected);
      setWorkspaceMode('files');
      useChatStore.getState().ensureProjectSession(selected);
      notifyProjectFilesChanged(selected);
    } catch {
      // Folder picker failures are non-fatal; the empty project state remains visible.
    }
  }, [setProjectPath, setWorkspaceMode, setWorkspaceSelectionPath]);

  const refreshProject = useCallback(() => {
    if (projectPath) notifyProjectFilesChanged(projectPath);
  }, [projectPath]);

  const fileBreadcrumbs = workspaceMode === 'files'
    ? selectedPathCrumbs(projectPath, workspaceSelectionPath || projectPath || undefined)
    : [];
  const modeItems: WorkspaceBreadcrumbItem[] = [
    { label: t('project.fileCrumb'), mode: 'files', path: projectPath || undefined },
    { label: t('preview.htmlPreview'), mode: 'preview' },
    { label: 'MP4', mode: 'mp4' },
  ];
  const visibleDoc = workspaceMode === 'mp4'
    ? activeDoc?.kind === 'video' ? activeDoc : null
    : workspaceMode === 'preview' && activeDoc?.kind !== 'video' ? activeDoc : null;
  const backgroundHtmlDoc: PreviewDocument | null = activeDoc?.kind === 'html'
    ? activeDoc
    : htmlDoc
    ? { name: t('preview.generatedHtml'), kind: 'html', source: 'generated', content: htmlDoc }
    : null;

  useEffect(() => {
    if (workspaceMode !== 'preview') return;
    const previewPath = previewDocument?.path;
    const needsProjectPreview = Boolean(
      projectPath
        && (autoOpenedProjectRef.current !== projectPath
          || !previewDocument
          || (previewPath && !isPathInside(projectPath, previewPath))),
    );
    if (!projectPath || !needsProjectPreview) return;
    autoOpenedProjectRef.current = projectPath;

    let cancelled = false;
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const entry = await invoke<string | null>('find_project_entry', { path: projectPath });
        if (cancelled) return;

        if (!entry) {
          setWorkspaceMode('preview');
          return;
        }

        const doc = await openPreviewFile(entry, fileName(entry));
        if (cancelled || !doc) return;
        setWorkspaceSelectionPath(entry);
        setWorkspaceMode(doc.kind === 'video' ? 'mp4' : 'preview');
        if (doc.kind === 'html' && doc.content) {
          useChatStore.getState().setHtmlDocument(doc.content);
        }
      } catch {
        if (!cancelled) setWorkspaceMode('preview');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openPreviewFile, previewDocument, projectPath, setWorkspaceMode, setWorkspaceSelectionPath, workspaceMode]);

  useEffect(() => {
    setCurrentSlide(0);
  }, [activeDocKey, workspaceMode]);

  const openProjectDocument = useCallback(async (path: string, fallbackMode: WorkspaceMode) => {
    setWorkspaceSelectionPath(path);
    setWorkspaceMode(fallbackMode);
    const doc = await openPreviewFile(path, fileName(path));
    if (!doc) return;
    setWorkspaceMode(doc.kind === 'video' ? 'mp4' : 'preview');
    if (doc.kind === 'html' && doc.content) {
      useChatStore.getState().setHtmlDocument(doc.content);
    }
  }, [openPreviewFile, setWorkspaceMode, setWorkspaceSelectionPath]);

  const openProjectHtmlPreview = useCallback(async () => {
    setWorkspaceMode('preview');
    if (!projectPath) return;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const entry = await invoke<string | null>('find_project_entry', { path: projectPath });
      await openProjectDocument(entry || projectHtmlPath(projectPath), 'preview');
    } catch {
      await openProjectDocument(projectHtmlPath(projectPath), 'preview');
    }
  }, [openProjectDocument, projectPath, setWorkspaceMode]);

  const selectBreadcrumb = useCallback((item: WorkspaceBreadcrumbItem) => {
    setWorkspaceMode(item.mode);
    if (item.mode === 'preview' && projectPath) {
      void openProjectHtmlPreview();
      return;
    }
    if (item.mode === 'mp4' && projectPath) {
      const latestMp4Path = renderStatus?.state === 'done' && renderStatus.outputPath
        ? renderStatus.outputPath
        : projectExportPath(projectPath, 'presentation-standard.mp4');
      void openProjectDocument(latestMp4Path, 'mp4');
      return;
    }
    if (item.path) {
      setWorkspaceSelectionPath(item.path);
    } else if (item.mode === 'files' && projectPath) {
      setWorkspaceSelectionPath(projectPath);
    }
  }, [openProjectDocument, openProjectHtmlPreview, projectPath, renderStatus, setWorkspaceMode, setWorkspaceSelectionPath]);

  return (
    <section className='min-w-[520px] flex-1 overflow-hidden bg-[var(--color-bg-primary)] max-xl:min-w-0 max-xl:flex-1'>
      <div className='flex h-full min-h-0 flex-col overflow-hidden'>
        <WorkspaceBreadcrumb
          items={modeItems}
          pathItems={fileBreadcrumbs}
          activeMode={workspaceMode}
          onSelectItem={selectBreadcrumb}
          onChooseFile={chooseFile}
          onChooseFolder={chooseFolder}
          onRefresh={refreshProject}
          canRefresh={Boolean(projectPath)}
        />

        <div className='min-h-0 flex-1 bg-[var(--color-bg-primary)]' data-workspace-mode={workspaceMode}>
          {backgroundHtmlDoc?.kind === 'html' && (
            <HtmlPreview
              htmlContent={backgroundHtmlDoc.content || ''}
              currentSlide={0}
              onSlideChange={() => undefined}
              onCapture={() => undefined}
              baseHref={backgroundHtmlDoc.source === 'file' ? baseHref(backgroundHtmlDoc.url) : undefined}
              backgroundOnly
              processRenderRequests
            />
          )}
          {workspaceMode === 'files' ? (
            <FileExplorer />
          ) : (
            <div className='h-full min-h-0 overflow-hidden bg-[var(--color-bg-primary)]'>
                {isLoading ? (
                  <PreviewState icon={<Loader2 size={20} className='animate-spin' />} title={t('preview.loading')} />
                ) : error ? (
                  <PreviewState icon={<AlertCircle size={20} />} title={t('preview.error')} body={error} />
                ) : visibleDoc ? (
                  <PreviewRenderer
                    doc={visibleDoc}
                    currentSlide={currentSlide}
                    onSlideChange={setCurrentSlide}
                    onCapture={handleCapture}
                  />
                ) : (
                  <PreviewState
                    icon={workspaceMode === 'mp4' ? <VideoOff size={20} /> : <FileQuestion size={20} />}
                    title={workspaceMode === 'mp4' ? 'MP4' : t('preview.emptyTitle')}
                    body={workspaceMode === 'mp4' ? t('preview.mp4EmptyHint') : t('preview.emptyHint')}
                  />
                )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function PreviewRenderer({
  doc,
  currentSlide,
  onSlideChange,
  onCapture,
}: {
  doc: PreviewDocument;
  currentSlide: number;
  onSlideChange: (index: number) => void;
  onCapture: (dataUrl: string, index: number) => void;
}) {
  const { t } = useI18n();

  if (doc.kind === 'html') {
    return (
      <HtmlPreview
        htmlContent={doc.content || ''}
        currentSlide={currentSlide}
        onSlideChange={onSlideChange}
        onCapture={onCapture}
        baseHref={doc.source === 'file' ? baseHref(doc.url) : undefined}
        processRenderRequests={false}
      />
    );
  }

  if (doc.kind === 'video') {
    return <VideoPreview doc={doc} />;
  }

  if (doc.kind === 'pdf') {
    return (
      <iframe
        src={doc.url}
        className='h-full w-full border-0 bg-white'
        title={doc.name}
      />
    );
  }

  if (doc.kind === 'markdown') {
    return (
      <div className='h-full overflow-auto bg-white px-8 py-7 text-[#172033]'>
        <article className='mx-auto max-w-4xl text-sm leading-7'>
          <ReactMarkdown
            components={{
              h1: ({ children }) => <h1 className='mb-5 text-3xl font-bold leading-tight'>{children}</h1>,
              h2: ({ children }) => <h2 className='mb-3 mt-7 text-2xl font-semibold'>{children}</h2>,
              h3: ({ children }) => <h3 className='mb-2 mt-5 text-lg font-semibold'>{children}</h3>,
              p: ({ children }) => <p className='mb-4'>{children}</p>,
              ul: ({ children }) => <ul className='mb-4 list-disc pl-6'>{children}</ul>,
              ol: ({ children }) => <ol className='mb-4 list-decimal pl-6'>{children}</ol>,
              code: ({ children }) => <code className='rounded bg-[#eef3f9] px-1.5 py-0.5 font-mono text-xs'>{children}</code>,
              pre: ({ children }) => <pre className='mb-4 overflow-auto rounded-xl bg-[#101828] p-4 text-xs text-white'>{children}</pre>,
              blockquote: ({ children }) => <blockquote className='mb-4 border-l-4 border-[#4f6bed] bg-[#f3f6fb] px-4 py-2 text-[#4b5563]'>{children}</blockquote>,
            }}
          >
            {doc.content || ''}
          </ReactMarkdown>
        </article>
      </div>
    );
  }

  if (doc.kind === 'image') {
    return (
      <div className='flex h-full items-center justify-center bg-[#101828] p-4'>
        <img src={doc.url} alt={doc.name} className='max-h-full max-w-full rounded-xl object-contain shadow-2xl' />
      </div>
    );
  }

  return <PreviewState icon={<FileQuestion size={20} />} title={t('preview.unsupported')} />;
}

function VideoPreview({ doc }: { doc: PreviewDocument }) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className='relative flex h-full items-center justify-center bg-[#0b0d12]'>
      {!error && (
        <video
          key={doc.url}
          src={doc.url}
          controls
          preload='metadata'
          className='h-full w-full object-contain'
          onError={(event) => {
            const media = event.currentTarget;
            setError(media.error?.message || t('preview.videoUnsupported'));
          }}
          onLoadedMetadata={() => setError(null)}
        />
      )}
      {error && (
        <div className='mx-6 max-w-lg rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-5 py-4 text-sm text-[var(--color-text-primary)] shadow-sm'>
          <div className='font-semibold'>{t('preview.unsupported')}</div>
          <p className='mt-2 text-xs leading-5 text-[var(--color-text-secondary)]'>{t('preview.videoUnsupported')}</p>
          {doc.path && (
            <div className='mt-3 rounded-[var(--radius-control)] bg-[var(--color-bg-tertiary)] px-3 py-2 text-[11px] leading-5 text-[var(--color-text-secondary)]'>
              <div className='font-medium text-[var(--color-text-primary)]'>{t('preview.videoPath')}</div>
              <div className='break-all'>{doc.path}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function baseHref(url?: string): string | undefined {
  if (!url) return undefined;
  const slash = url.lastIndexOf('/');
  return slash === -1 ? undefined : url.slice(0, slash + 1);
}

function PreviewState({ icon, title, body }: { icon: React.ReactNode; title: string; body?: string }) {
  return (
    <div className='flex h-full items-center justify-center bg-[var(--color-bg-secondary)] p-8 text-center'>
      <div className='max-w-sm'>
        <div className='mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-sm font-semibold text-[var(--color-text-secondary)] shadow-sm'>
          {icon}
        </div>
        <h2 className='text-base font-semibold text-[var(--color-text-primary)]'>{title}</h2>
        {body && <p className='mt-2 text-xs leading-5 text-[var(--color-text-secondary)]'>{body}</p>}
      </div>
    </div>
  );
}

function WorkspaceBreadcrumb({
  items,
  pathItems,
  activeMode,
  onSelectItem,
  onChooseFile,
  onChooseFolder,
  onRefresh,
  canRefresh,
}: {
  items: WorkspaceBreadcrumbItem[];
  pathItems: WorkspaceBreadcrumbItem[];
  activeMode: WorkspaceMode;
  onSelectItem: (item: WorkspaceBreadcrumbItem) => void;
  onChooseFile: () => void;
  onChooseFolder: () => void;
  onRefresh: () => void;
  canRefresh: boolean;
}) {
  const { t } = useI18n();

  return (
    <div className='flex h-11 flex-shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3'>
      <nav
        aria-label='breadcrumb'
        data-testid='workspace-breadcrumb'
        className='flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-[13px]'
      >
        {items.map((item, index) => {
          const isActive = item.mode === activeMode;
          return (
            <div
              key={`${item.label}-${item.path || item.mode}-${index}`}
              className='flex flex-shrink-0 items-center gap-0.5'
            >
              {index > 0 && (
                <ChevronRight
                  size={14}
                  className='flex-shrink-0 text-[var(--color-text-secondary)]/55'
                />
              )}
              <button
                type='button'
                data-active={isActive ? 'true' : 'false'}
                data-mode={item.mode}
                onClick={() => onSelectItem(item)}
                title={item.path || item.label}
                className={`min-w-0 truncate rounded-[var(--radius-control)] px-1.5 py-1 ${
                  isActive
                    ? 'bg-[var(--color-bg-tertiary)] font-semibold text-[var(--color-text-primary)]'
                    : 'font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {item.label}
              </button>
            </div>
          );
        })}
        {activeMode === 'files' && pathItems.map((item) => (
          <div
            key={`${item.path || item.label}-path`}
            className='flex min-w-0 items-center gap-0.5'
          >
            <ChevronRight
              size={14}
              className='flex-shrink-0 text-[var(--color-text-secondary)]/55'
            />
            <button
              type='button'
              data-active='true'
              data-mode={item.mode}
              onClick={() => onSelectItem(item)}
              title={item.path || item.label}
              className='min-w-0 truncate rounded-[var(--radius-control)] px-1.5 py-1 font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
            >
              {item.label}
            </button>
          </div>
        ))}
      </nav>

      <div className='flex flex-shrink-0 items-center gap-1.5'>
        <button
          type='button'
          onClick={onChooseFile}
          title={t('sidebar.openFile')}
          aria-label={t('sidebar.openFile')}
          className='inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
        >
          <FileText size={15} />
        </button>
        <button
          type='button'
          onClick={onChooseFolder}
          title={t('sidebar.chooseFolder')}
          aria-label={t('sidebar.chooseFolder')}
          className='inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
        >
          <FolderOpen size={15} />
        </button>
        <button
          type='button'
          onClick={onRefresh}
          disabled={!canRefresh}
          title={t('sidebar.refresh')}
          aria-label={t('sidebar.refresh')}
          className='inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-35'
        >
          <RefreshCw size={15} />
        </button>
      </div>
    </div>
  );
}

function selectedPathCrumbs(projectPath: string | null, selectedPath?: string): WorkspaceBreadcrumbItem[] {
  const target = selectedPath || projectPath;
  if (!target) return [];

  const normalizedTarget = normalizePath(target);
  if (projectPath) {
    const normalizedProject = normalizePath(projectPath);
    const inProject = normalizedTarget === normalizedProject || normalizedTarget.startsWith(`${normalizedProject}/`);
    if (inProject) {
      const relative = normalizedTarget.slice(normalizedProject.length).replace(/^\/+/, '');
      const projectName = fileName(projectPath);
      const crumbs: WorkspaceBreadcrumbItem[] = [{ label: projectName, mode: 'files', path: projectPath }];
      let cursor = projectPath;
      for (const part of relative.split('/').filter(Boolean)) {
        cursor = joinProjectPath(cursor, part);
        crumbs.push({ label: part, mode: 'files', path: cursor });
      }
      return crumbs;
    }
  }

  return [{ label: fileName(target), mode: 'files', path: target }];
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/g, '');
}

function isPathInside(root: string, path: string): boolean {
  const normalizedRoot = normalizePath(root);
  const normalizedPath = normalizePath(path);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

