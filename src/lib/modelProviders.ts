export interface ModelProviderPreset {
  id: string;
  label: string;
  apiUrl: string;
  defaultModel: string;
  modelPlaceholder: string;
  requiresKey: boolean;
  supportsVision: boolean;
  useDefaultOcr: boolean;
}

export const MODEL_PROVIDER_PRESETS: ModelProviderPreset[] = [
  {
    id: 'custom',
    label: 'Custom OpenAI-compatible',
    apiUrl: '',
    defaultModel: '',
    modelPlaceholder: 'provider-model-name',
    requiresKey: true,
    supportsVision: false,
    useDefaultOcr: true,
  },
  {
    id: 'openai',
    label: 'OpenAI / GPT',
    apiUrl: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4.1',
    modelPlaceholder: 'gpt-4.1 / gpt-4o / o-series',
    requiresKey: true,
    supportsVision: true,
    useDefaultOcr: true,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    apiUrl: 'https://api.deepseek.com/v1/chat/completions',
    defaultModel: 'deepseek-chat',
    modelPlaceholder: 'deepseek-chat / deepseek-reasoner',
    requiresKey: true,
    supportsVision: false,
    useDefaultOcr: true,
  },
  {
    id: '4router',
    label: '4router',
    apiUrl: 'https://4router.net/v1/chat/completions',
    defaultModel: 'gpt-5.5',
    modelPlaceholder: 'gpt-5.5',
    requiresKey: true,
    supportsVision: true,
    useDefaultOcr: true,
  },
  {
    id: 'glm',
    label: 'GLM / Zhipu',
    apiUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    defaultModel: 'glm-4.5',
    modelPlaceholder: 'glm-4.5 / glm-4-plus',
    requiresKey: true,
    supportsVision: true,
    useDefaultOcr: true,
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'openai/gpt-4.1',
    modelPlaceholder: 'openai/gpt-4.1 / deepseek/deepseek-chat',
    requiresKey: true,
    supportsVision: true,
    useDefaultOcr: true,
  },
  {
    id: 'ollama',
    label: 'Ollama local',
    apiUrl: 'http://localhost:11434/v1/chat/completions',
    defaultModel: 'qwen2.5:7b',
    modelPlaceholder: 'qwen2.5:7b / llama3.1:8b',
    requiresKey: false,
    supportsVision: false,
    useDefaultOcr: true,
  },
];

export function providerPreset(id: string | null | undefined): ModelProviderPreset {
  return MODEL_PROVIDER_PRESETS.find((preset) => preset.id === id) || MODEL_PROVIDER_PRESETS[0];
}
