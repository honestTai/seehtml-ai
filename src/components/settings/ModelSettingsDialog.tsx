import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Eye, FileText, KeyRound, Link2, Loader2, Save, Server, SlidersHorizontal, X } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { MODEL_PROVIDER_PRESETS, providerPreset } from '../../lib/modelProviders';
import { useUIStore } from '../../stores/uiStore';

interface AiConfig {
  provider: string;
  api_url: string;
  api_key: string;
  model: string;
  temperature: number;
  max_tokens: number;
  use_auth_header: boolean;
  supports_vision: boolean;
  use_default_ocr: boolean;
}

interface AiConfigResponse {
  config: AiConfig;
  config_path?: string | null;
  configured: boolean;
}

const DEFAULT_CONFIG: AiConfig = {
  provider: 'custom',
  api_url: '',
  api_key: '',
  model: '',
  temperature: 0.7,
  max_tokens: 8192,
  use_auth_header: true,
  supports_vision: false,
  use_default_ocr: true,
};

export function ModelSettingsDialog() {
  const { t } = useI18n();
  const open = useUIStore((s) => s.modelSettingsOpen);
  const setOpen = useUIStore((s) => s.setModelSettingsOpen);
  const [config, setConfig] = useState<AiConfig>(DEFAULT_CONFIG);
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const selectedPreset = useMemo(() => providerPreset(config.provider), [config.provider]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setStatus(null);
    void (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const response = await invoke<AiConfigResponse>('get_ai_config');
        if (cancelled) return;
        setConfig({ ...DEFAULT_CONFIG, ...response.config });
        setConfigPath(response.config_path || null);
        setConfigured(Boolean(response.configured));
      } catch (error) {
        if (!cancelled) {
          setStatus(modelSettingsErrorMessage(error, t('settings.desktopOnly')));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const applyProvider = (provider: string) => {
    const preset = providerPreset(provider);
    setConfig((current) => ({
      ...current,
      provider,
      api_url: provider === 'custom' ? current.api_url : preset.apiUrl,
      model: provider === 'custom' ? current.model : preset.defaultModel,
      use_auth_header: preset.requiresKey,
      supports_vision: preset.supportsVision,
      use_default_ocr: preset.useDefaultOcr,
    }));
  };

  const save = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const response = await invoke<AiConfigResponse>('update_ai_config', {
        provider: config.provider,
        apiUrl: config.api_url.trim(),
        apiKey: config.api_key,
        model: config.model.trim(),
        temperature: Number(config.temperature) || 0.7,
        maxTokens: Math.max(1, Number(config.max_tokens) || 8192),
        useAuthHeader: Boolean(config.use_auth_header),
        supportsVision: Boolean(config.supports_vision),
        useDefaultOcr: Boolean(config.use_default_ocr),
      });
      setConfig({ ...DEFAULT_CONFIG, ...response.config });
      setConfigPath(response.config_path || null);
      setConfigured(Boolean(response.configured));
      setStatus(t('settings.saved'));
    } catch (error) {
      setStatus(modelSettingsErrorMessage(error, t('settings.desktopOnly')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4 backdrop-blur-sm'
      onClick={() => setOpen(false)}
    >
      <section
        role='dialog'
        aria-modal='true'
        aria-labelledby='model-settings-title'
        className='flex max-h-[86vh] w-full max-w-[680px] flex-col overflow-hidden rounded-[var(--radius-panel)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] shadow-2xl'
        onClick={(event) => event.stopPropagation()}
      >
        <header className='flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-4'>
          <span className='flex h-9 w-9 items-center justify-center rounded-[var(--radius-control)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'>
            <Server size={18} />
          </span>
          <div className='min-w-0'>
            <h2 id='model-settings-title' className='text-base font-semibold text-[var(--color-text-primary)]'>
              {t('settings.modelTitle')}
            </h2>
            <p className='truncate text-xs text-[var(--color-text-secondary)]'>
              {configured ? t('settings.configured') : t('settings.unconfigured')}
            </p>
          </div>
          <button
            type='button'
            className='ml-auto flex h-8 w-8 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
            onClick={() => setOpen(false)}
            aria-label={t('panel.collapse')}
          >
            <X size={17} />
          </button>
        </header>

        <div className='min-h-0 flex-1 overflow-y-auto px-5 py-4'>
          {loading ? (
            <div className='flex items-center gap-2 text-sm text-[var(--color-text-secondary)]'>
              <Loader2 size={16} className='animate-spin' />
              {t('settings.loading')}
            </div>
          ) : (
            <div className='grid gap-4'>
              <label className='grid gap-1.5'>
                <span className='text-xs font-medium text-[var(--color-text-secondary)]'>{t('settings.provider')}</span>
                <select
                  value={config.provider}
                  onChange={(event) => applyProvider(event.target.value)}
                  className='h-10 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]'
                >
                  {MODEL_PROVIDER_PRESETS.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.label}</option>
                  ))}
                </select>
              </label>

              <LabeledInput
                icon={<Link2 size={15} />}
                label={t('settings.apiUrl')}
                value={config.api_url}
                placeholder='https://api.example.com/v1/chat/completions'
                onChange={(value) => setConfig((current) => ({ ...current, api_url: value }))}
              />

              <LabeledInput
                icon={<KeyRound size={15} />}
                label={t('settings.apiKey')}
                type='password'
                value={config.api_key}
                placeholder={selectedPreset.requiresKey ? t('settings.apiKeyPlaceholder') : t('settings.apiKeyOptional')}
                onChange={(value) => setConfig((current) => ({ ...current, api_key: value }))}
              />

              <LabeledInput
                icon={<Server size={15} />}
                label={t('settings.model')}
                value={config.model}
                placeholder={selectedPreset.modelPlaceholder}
                onChange={(value) => setConfig((current) => ({ ...current, model: value }))}
              />

              <div className='grid gap-3 sm:grid-cols-2'>
                <LabeledInput
                  icon={<SlidersHorizontal size={15} />}
                  label='Temperature'
                  type='number'
                  min='0'
                  max='2'
                  step='0.1'
                  value={String(config.temperature)}
                  onChange={(value) => setConfig((current) => ({ ...current, temperature: Number(value) }))}
                />
                <LabeledInput
                  icon={<SlidersHorizontal size={15} />}
                  label='Max tokens'
                  type='number'
                  min='1'
                  step='1'
                  value={String(config.max_tokens)}
                  onChange={(value) => setConfig((current) => ({ ...current, max_tokens: Number(value) }))}
                />
              </div>

              <label className='flex items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2.5'>
                <span className='min-w-0'>
                  <span className='block text-sm font-medium text-[var(--color-text-primary)]'>{t('settings.authHeader')}</span>
                  <span className='block text-xs text-[var(--color-text-secondary)]'>{t('settings.authHint')}</span>
                </span>
                <input
                  type='checkbox'
                  checked={config.use_auth_header}
                  onChange={(event) => setConfig((current) => ({ ...current, use_auth_header: event.target.checked }))}
                  className='h-4 w-4 accent-[var(--color-accent)]'
                />
              </label>

              <div className='grid gap-3 sm:grid-cols-2'>
                <ToggleRow
                  icon={<Eye size={15} />}
                  label={t('settings.visionSupport')}
                  hint={t('settings.visionHint')}
                  checked={config.supports_vision}
                  onChange={(checked) => setConfig((current) => ({ ...current, supports_vision: checked }))}
                />
                <ToggleRow
                  icon={<FileText size={15} />}
                  label={t('settings.defaultOcr')}
                  hint={t('settings.defaultOcrHint')}
                  checked={config.use_default_ocr}
                  onChange={(checked) => setConfig((current) => ({ ...current, use_default_ocr: checked }))}
                />
              </div>

              <p className='text-xs leading-5 text-[var(--color-text-secondary)]'>
                {t('settings.compatHint')}
              </p>
              {configPath && (
                <p className='truncate rounded-[var(--radius-control)] bg-[var(--color-bg-primary)] px-3 py-2 font-mono text-[11px] text-[var(--color-text-secondary)]'>
                  {configPath}
                </p>
              )}
            </div>
          )}
        </div>

        <footer className='flex items-center gap-3 border-t border-[var(--color-border)] px-5 py-3'>
          <span className={`min-w-0 flex-1 truncate text-xs ${status === t('settings.saved') ? 'text-[var(--color-success)]' : 'text-[var(--color-text-secondary)]'}`}>
            {status || t('settings.localOnly')}
          </span>
          <button
            type='button'
            className='rounded-[var(--radius-control)] px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-text-primary)]'
            onClick={() => setOpen(false)}
          >
            {t('settings.close')}
          </button>
          <button
            type='button'
            disabled={saving || loading}
            className='inline-flex items-center gap-2 rounded-[var(--radius-control)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-60'
            onClick={save}
          >
            {saving ? <Loader2 size={15} className='animate-spin' /> : <Save size={15} />}
            {t('settings.save')}
          </button>
        </footer>
      </section>
    </div>
  );
}

function ToggleRow({
  icon,
  label,
  hint,
  checked,
  onChange,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className='flex min-h-[76px] items-center justify-between gap-3 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2.5'>
      <span className='flex min-w-0 items-start gap-2'>
        <span className='mt-0.5 text-[var(--color-text-secondary)]'>{icon}</span>
        <span className='min-w-0'>
          <span className='block text-sm font-medium text-[var(--color-text-primary)]'>{label}</span>
          <span className='block text-xs leading-4 text-[var(--color-text-secondary)]'>{hint}</span>
        </span>
      </span>
      <input
        type='checkbox'
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className='h-4 w-4 flex-shrink-0 accent-[var(--color-accent)]'
      />
    </label>
  );
}

function modelSettingsErrorMessage(error: unknown, desktopOnlyMessage: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/invoke|__TAURI__|__TAURI_INTERNALS__/i.test(message)) {
    return desktopOnlyMessage;
  }
  return message;
}

function LabeledInput({
  icon,
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  min,
  max,
  step,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  min?: string;
  max?: string;
  step?: string;
}) {
  return (
    <label className='grid gap-1.5'>
      <span className='text-xs font-medium text-[var(--color-text-secondary)]'>{label}</span>
      <span className='flex h-10 items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 focus-within:border-[var(--color-accent)]'>
        <span className='text-[var(--color-text-secondary)]'>{icon}</span>
        <input
          type={type}
          min={min}
          max={max}
          step={step}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className='min-w-0 flex-1 bg-transparent text-sm text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-secondary)]/45'
        />
      </span>
    </label>
  );
}
