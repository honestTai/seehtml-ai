import { useRef, useState, useCallback, useEffect } from 'react';
import { ArrowUp, FileText, FolderOpen, ImagePlus, X } from 'lucide-react';
import { useChatStore } from '../../stores/chatStore';
import { useI18n } from '../../lib/i18n';
import { PREVIEWABLE_EXTENSIONS, usePreviewStore } from '../../stores/previewStore';
import { useUIStore } from '../../stores/uiStore';
import { notifyProjectFilesChanged } from '../../lib/projectPaths';
import { pickExistingProject } from '../../lib/workspace';

interface AttachedImage {
  id: string;
  dataUrl: string;
  name: string;
}

export function ChatInput() {
  const { t } = useI18n();
  const inputValue = useChatStore((s) => s.inputValue);
  const setInputValue = useChatStore((s) => s.setInputValue);
  const sendCommand = useChatStore((s) => s.sendCommand);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const stopProcessing = useChatStore((s) => s.stopProcessing);
  const addMessage = useChatStore((s) => s.addMessage);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const hasImages = attachedImages.length > 0;
  const canSend = inputValue.trim().length > 0 || hasImages;

  useEffect(() => {
    const focusInput = () => {
      window.setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
    };
    window.addEventListener('seehtml:focus-chat-input', focusInput);
    return () => window.removeEventListener('seehtml:focus-chat-input', focusInput);
  }, []);

  const appendFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    const images = await Promise.all(imageFiles.map(readImageFile));
    setAttachedImages((prev) => [...prev, ...images]);
  }, []);

  const handleSend = useCallback(() => {
    const val = inputValue.trim();
    if (!val && !hasImages) return;

    if (hasImages) {
      const prompt = val || (attachedImages.length > 1 ? t('chat.imagesDefault') : t('chat.imageDefault'));
      sendMessage(prompt, attachedImages.map((image) => image.dataUrl));
      setAttachedImages([]);
    } else if (val.startsWith('/')) {
      sendCommand(val);
    } else {
      sendMessage(val);
    }
    inputRef.current?.focus();
  }, [inputValue, hasImages, attachedImages, sendCommand, sendMessage, t]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imageFiles = items
      .filter((item) => item.type.startsWith('image/'))
      .map((item, index) => item.getAsFile() || new File([], `pasted-image-${index + 1}.png`, { type: item.type }))
      .filter((file) => file.size > 0);
    if (imageFiles.length === 0) return;
    e.preventDefault();
    void appendFiles(imageFiles);
  }, [appendFiles]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.currentTarget.value = '';
    void appendFiles(files);
  }, [appendFiles]);

  const removeImage = (id: string) => {
    setAttachedImages((prev) => prev.filter((image) => image.id !== id));
  };

  const openLocalFile = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: false,
        multiple: false,
        filters: [{ name: 'HTML / Video / PDF / Markdown / Image', extensions: PREVIEWABLE_EXTENSIONS }],
      });
      if (typeof selected !== 'string') return;

      const doc = await usePreviewStore.getState().openFile(selected, fileName(selected));
      if (!doc) return;

      const ui = useUIStore.getState();
      ui.setWorkspaceSelectionPath(selected);
      ui.setWorkspaceMode(doc.kind === 'video' ? 'mp4' : 'preview');
      if (doc.kind === 'html' && doc.content) {
        useChatStore.getState().setHtmlDocument(doc.content);
      }
      addMessage({
        id: crypto.randomUUID(),
        role: 'system',
        content: `${t('chat.openedFile')}\n${selected}`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      addMessage({
        id: crypto.randomUUID(),
        role: 'system',
        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date().toISOString(),
      });
    }
  }, [addMessage, t]);

  const openLocalFolder = useCallback(async () => {
    try {
      const selected = await pickExistingProject();
      if (!selected) return;
      const ui = useUIStore.getState();
      ui.setProjectPath(selected);
      ui.setWorkspaceSelectionPath(selected);
      ui.setWorkspaceMode('files');
      useChatStore.getState().ensureProjectSession(selected);
      notifyProjectFilesChanged(selected);
      addMessage({
        id: crypto.randomUUID(),
        role: 'system',
        content: `${t('project.open')}\n${selected}`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      addMessage({
        id: crypto.randomUUID(),
        role: 'system',
        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date().toISOString(),
      });
    }
  }, [addMessage, t]);

  return (
    <div className='border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-3'>
      <div>
        <div className='rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 transition-colors focus-within:border-[var(--color-accent)]'>
          {hasImages && (
            <div className='mb-2 flex max-h-36 flex-wrap gap-2 overflow-y-auto pr-1'>
              {attachedImages.map((image) => (
                <div key={image.id} className='group relative h-20 w-24 overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)]'>
                  <img src={image.dataUrl} alt={image.name} className='h-full w-full object-cover' />
                  <button
                    type='button'
                    onClick={() => removeImage(image.id)}
                    className='absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-[var(--radius-control)] bg-black/65 text-xs leading-none text-white opacity-90 transition-opacity hover:bg-[var(--color-danger)] group-hover:opacity-100'
                    title='Remove image'
                    aria-label={`Remove ${image.name}`}
                  >
                    <X size={12} />
                  </button>
                  <div className='absolute inset-x-0 bottom-0 truncate bg-black/60 px-1.5 py-0.5 text-[9px] text-white'>
                    {image.name}
                  </div>
                </div>
              ))}
            </div>
          )}

          <textarea
            ref={inputRef}
            name='agent-message'
            aria-label={hasImages ? t('chat.placeholderImage') : t('chat.placeholder')}
            autoComplete='off'
            spellCheck={true}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={hasImages ? t('chat.placeholderImage') : t('chat.placeholder')}
            className='max-h-28 min-h-12 w-full resize-none bg-transparent px-1 py-1 text-[13px] leading-5 text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)]/70'
            rows={2}
          />

          <div className='flex items-center gap-2 pt-1'>
            <button
              type='button'
              onClick={openLocalFile}
              className='flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
              title={t('chat.openFile')}
              aria-label={t('chat.openFile')}
            >
              <FileText size={16} />
            </button>
            <button
              type='button'
              onClick={openLocalFolder}
              className='flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
              title={t('chat.openFolder')}
              aria-label={t('chat.openFolder')}
            >
              <FolderOpen size={16} />
            </button>
            <button
              type='button'
              onClick={() => fileRef.current?.click()}
              className='flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
              title={t('chat.attachImage')}
              aria-label={t('chat.attachImage')}
            >
              <ImagePlus size={16} />
            </button>
            <input ref={fileRef} type='file' accept='image/*' multiple onChange={handleFileChange} className='hidden' aria-label={t('chat.attachImage')} />
            <span className='text-[11px] text-[var(--color-text-secondary)]/75'>
              {hasImages ? `${attachedImages.length} ${t('chat.images')}` : t('chat.pasteImage')}
            </span>
            <span className='flex-1' />
            {isProcessing && (
              <button
                type='button'
                onClick={stopProcessing}
                className='rounded-[var(--radius-control)] bg-[var(--color-danger)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:brightness-95'
                aria-label={t('chat.stop')}
              >
                {t('chat.stop')}
              </button>
            )}
            <button
              type='button'
              onClick={handleSend}
              disabled={!canSend}
              className='flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-accent)] text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-45'
              title={isProcessing ? t('chat.append') : t('chat.send')}
              aria-label={isProcessing ? t('chat.append') : t('chat.send')}
            >
              <ArrowUp size={17} strokeWidth={2.4} />
            </button>
          </div>
        </div>
        <div className='mt-2 flex flex-wrap gap-x-3 gap-y-1 px-1 text-[10px] text-[var(--color-text-secondary)]/65'>
          <span>/open</span><span>/ai</span><span>/export pptx</span><span>/export video</span>
        </div>
      </div>
    </div>
  );
}

function readImageFile(file: File, index: number): Promise<AttachedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        id: crypto.randomUUID(),
        dataUrl: reader.result as string,
        name: file.name || `pasted-image-${index + 1}.png`,
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}
