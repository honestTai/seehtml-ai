import { useRef, useState, useCallback } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { useI18n } from '../../lib/i18n';

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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const hasImages = attachedImages.length > 0;

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

  return (
    <div className='border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-3'>
      <div className='mx-auto max-w-3xl'>
        <div className='rounded-[20px] border border-[var(--color-border)] bg-white px-3 py-2 shadow-[0_8px_28px_rgba(31,35,40,0.08)] transition-colors focus-within:border-[var(--color-accent)]'>
          {hasImages && (
            <div className='mb-2 flex max-h-36 flex-wrap gap-2 overflow-y-auto pr-1'>
              {attachedImages.map((image) => (
                <div key={image.id} className='group relative h-20 w-24 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]'>
                  <img src={image.dataUrl} alt={image.name} className='h-full w-full object-cover' />
                  <button
                    onClick={() => removeImage(image.id)}
                    className='absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/65 text-xs leading-none text-white opacity-90 transition-opacity hover:bg-[var(--color-danger)] group-hover:opacity-100'
                    title='Remove image'
                  >
                    x
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
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={hasImages ? t('chat.placeholderImage') : t('chat.placeholder')}
            className='max-h-32 min-h-14 w-full resize-none bg-transparent px-1 py-1 text-sm leading-6 text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)]/65 focus:outline-none'
            rows={2}
          />

          <div className='flex items-center gap-2 pt-1'>
            <button
              onClick={() => fileRef.current?.click()}
              className='flex h-8 w-8 items-center justify-center rounded-full border border-[var(--color-border)] bg-white text-lg leading-none text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
              title={t('chat.attachImage')}
            >
              +
            </button>
            <input ref={fileRef} type='file' accept='image/*' multiple onChange={handleFileChange} className='hidden' />
            <span className='text-[11px] text-[var(--color-text-secondary)]/75'>
              {hasImages ? `${attachedImages.length} ${t('chat.images')}` : t('chat.pasteImage')}
            </span>
            <span className='flex-1' />
            {isProcessing && (
              <button
                onClick={stopProcessing}
                className='rounded-full bg-[var(--color-danger)] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:brightness-95'
              >
                {t('chat.stop')}
              </button>
            )}
            <button
              onClick={handleSend}
              disabled={!inputValue.trim() && !hasImages}
              className='flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-accent)] text-base font-semibold text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50'
              title={isProcessing ? t('chat.append') : 'Send'}
            >
              ↑
            </button>
          </div>
        </div>
        <div className='mt-2 flex flex-wrap gap-x-3 gap-y-1 px-1 text-[10px] text-[var(--color-text-secondary)]/60'>
          <span>/open</span><span>/export</span><span>/ai</span><span>/theme</span><span>/publish</span>
          <span className='ml-auto'>{t('chat.pasteImage')}</span>
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
