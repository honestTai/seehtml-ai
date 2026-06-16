import { useRef, useState, useCallback } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { useI18n } from '../../lib/i18n';

export function ChatInput() {
  const { t } = useI18n();
  const inputValue = useChatStore((s) => s.inputValue);
  const setInputValue = useChatStore((s) => s.setInputValue);
  const sendCommand = useChatStore((s) => s.sendCommand);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const stopProcessing = useChatStore((s) => s.stopProcessing);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachedImage, setAttachedImage] = useState<{ dataUrl: string; name: string } | null>(null);

  const sendMessage = useChatStore((s) => s.sendMessage);

  const handleSend = useCallback(() => {
    const val = inputValue.trim();
    if (!val && !attachedImage) return;

    if (attachedImage) {
      // Send image + optional text for analysis
      const prompt = val || t('chat.imageDefault');
      sendMessage(prompt, attachedImage.dataUrl);
      setAttachedImage(null);
    } else if (val.startsWith('/')) {
      sendCommand(val);
    } else {
      sendMessage(val);
    }
    inputRef.current?.focus();
  }, [inputValue, attachedImage, sendCommand, sendMessage, t]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // Handle image paste (Ctrl+V)
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) continue;
        const reader = new FileReader();
        reader.onload = () => {
          setAttachedImage({ dataUrl: reader.result as string, name: 'pasted-image.png' });
        };
        reader.readAsDataURL(blob);
        break;
      }
    }
  }, []);

  // Handle file upload
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setAttachedImage({ dataUrl: reader.result as string, name: file.name });
    };
    reader.readAsDataURL(file);
  }, []);

  const removeImage = () => setAttachedImage(null);

  return (
    <div className='border-t border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3'>
      {/* Image preview */}
      {attachedImage && (
        <div className='mb-2 relative inline-block'>
          <img src={attachedImage.dataUrl} alt={attachedImage.name}
            className='max-h-32 rounded-2xl border border-[var(--color-border)]' />
          <button onClick={removeImage}
        className='absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white hover:bg-red-600'>
            x
          </button>
          <div className='text-[10px] text-[var(--color-text-secondary)] mt-0.5'>{attachedImage.name}</div>
        </div>
      )}

      <div className='flex gap-2'>
        {/* Image upload button */}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={isProcessing}
          className='self-end rounded-full border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-2 py-2 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-border)] disabled:opacity-50'
          title={t('chat.attachImage')}
        >🖼️</button>
        <input ref={fileRef} type='file' accept='image/*' onChange={handleFileChange} className='hidden' />

        <textarea
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={attachedImage ? t('chat.placeholderImage') : t('chat.placeholder')}
          disabled={isProcessing}
          className='h-16 flex-1 resize-none rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] px-3 py-2 text-xs text-[var(--color-text-primary)] transition-colors placeholder-[var(--color-text-secondary)]/50 focus:border-[var(--color-accent)] focus:outline-none'
          rows={2}
        />
        <button
          onClick={isProcessing ? stopProcessing : handleSend}
          disabled={!isProcessing && !inputValue.trim() && !attachedImage}
          className={`self-end rounded-full px-3 py-2 text-xs font-medium text-white transition-colors ${
            isProcessing
              ? 'bg-[var(--color-danger)] hover:brightness-95'
              : 'bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50'
          }`}
        >{isProcessing ? t('chat.stop') : attachedImage ? '🔍' : '▶'}</button>
      </div>
      <div className='mt-2 flex gap-2 text-[10px] text-[var(--color-text-secondary)]/60'>
        <span>/open</span><span>/export</span><span>/ai</span><span>/theme</span><span>/publish</span>
        <span className='ml-auto'>🖼️ {t('chat.pasteImage')}</span>
      </div>
    </div>
  );
}
