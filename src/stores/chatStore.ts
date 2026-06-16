import { create } from 'zustand';
import type { AgentToolEvent, ChatMessage, ProcessingStep, QueuedRequest, WorkflowStep } from '../types';
import { runAgentLoop, type LlmMessage } from '../lib/agentLoop';
import { getLanguage, t, type Lang } from '../lib/i18n';
import { PREVIEWABLE_EXTENSIONS, usePreviewStore } from './previewStore';
import {
  buildHtmlSkillPrompt,
  selectHtmlSkill,
  skillLabel,
  summarizeHtmlQuality,
  validateHtmlQuality,
  type HtmlQualityCheck,
  type HtmlSkill,
} from '../lib/htmlSkills';

const STORAGE_KEY = 'seehtml-chat-history';
const MEMORY_KEY = 'seehtml-memory';
const REQUEST_TIMEOUT_MS = 180_000;

interface ChatState {
  messages: ChatMessage[];
  inputValue: string;
  isProcessing: boolean;
  processingSteps: ProcessingStep[];
  queuedRequests: QueuedRequest[];
  activeRequestId: string | null;
  htmlDocument: string | null;
  conversationMemory: Record<string, string>;
  setInputValue: (v: string) => void;
  addMessage: (msg: ChatMessage) => void;
  sendMessage: (content: string, imageDataUrl?: string) => Promise<void>;
  sendCommand: (command: string, params?: unknown) => Promise<void>;
  stopProcessing: () => void;
  clearMessages: () => void;
  setHtmlDocument: (html: string | null) => void;
  saveMemory: (key: string, value: string) => void;
  getMemory: (key: string) => string | undefined;
  loadHistory: () => void;
  saveHistory: () => void;
}

const WELCOME_MSG: Record<Lang, string> = {
  zh: `欢迎使用 SeeHTML AI。

你可以直接输入需求，AI 会在内部进行多轮工具调用，界面只展示最终结果。

试试：
- 打开一个 HTML 文件
- 生成 5 页关于量子计算的 HTML 页面
- 给当前页面换成深色科技风
- 将当前页面导出为 PPTX 或 Markdown`,
  en: `Welcome to SeeHTML AI.

Type naturally. The AI can run multi-step tool calls internally, while the UI shows only the final result.

Try:
- Open an HTML file
- Generate 5 HTML pages about quantum computing
- Apply a dark tech style to the current page
- Export the current page as PPTX or Markdown`,
};

const SYSTEM_PROMPT = `You are SeeHTML AI, an HTML page creation assistant.
You are the reasoning and planning layer before any tool execution.
First understand the user's intent. Use tools only when the app router exposes a small whitelist for this exact request.
If no tool is necessary, answer directly or return a complete usable HTML document when the user asks you to create/edit HTML.
Never call document/export/media tools just because they exist. Do not inspect or export a document unless the user explicitly asked for that operation and the required file/document is available.
If the user's request is unclear or missing required details, ask a concise follow-up question before using tools. You may ask follow-up questions across multiple turns until the request is actionable.
If you generate or edit HTML, return complete usable HTML or a concise summary after the tool call.
Never answer only "Task completed." Explain the concrete result.
Respond in the same language as the user.`;

function createWelcomeMessage(): ChatMessage {
  return {
    id: 'welcome',
    role: 'system',
    content: WELCOME_MSG[getLanguage()],
    timestamp: new Date().toISOString(),
  };
}

function loadSavedMessages(): ChatMessage[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return [createWelcomeMessage()];
}

function loadMemory(): Record<string, string> {
  try {
    const saved = localStorage.getItem(MEMORY_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return {};
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: loadSavedMessages(),
  inputValue: '',
  isProcessing: false,
  processingSteps: [],
  queuedRequests: [],
  activeRequestId: null,
  htmlDocument: null,
  conversationMemory: loadMemory(),

  setInputValue: (v) => set({ inputValue: v }),

  addMessage: (msg) => {
    set((s) => ({ messages: [...s.messages, msg] }));
    get().saveHistory();
  },

  sendMessage: async (content: string, imageDataUrl?: string) => {
    const state = get();
    if (!content.trim() && !imageDataUrl) return;
    if (state.isProcessing) {
      queueRequest(set, {
        id: crypto.randomUUID(),
        kind: 'message',
        content,
        imageDataUrl,
        createdAt: new Date().toISOString(),
      });
      return;
    }

    const displayContent = content.trim() || t('chat.imageDefault');
    const intent = classifyIntent(content, Boolean(imageDataUrl), Boolean(state.htmlDocument));
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: displayContent,
      imageDataUrl,
      timestamp: new Date().toISOString(),
    };
    const requestId = crypto.randomUUID();
    set({
      messages: [...state.messages, userMsg],
      inputValue: '',
      isProcessing: true,
      activeRequestId: requestId,
      processingSteps: createProcessingSteps(intent),
    });
    beginProcessingTimeline(set, get, requestId, intent);

    try {
      const prompt = imageDataUrl
        ? await withTimeout(buildImagePrompt(content, imageDataUrl, intent.htmlSkill), REQUEST_TIMEOUT_MS, t('chat.timeout'))
        : buildPromptForIntent(content, state.htmlDocument, intent);

      const { assistantContent, messages } = await withTimeout(
        runAgentLoop(
          prompt,
          state.messages.filter((m) => m.role !== 'system' || m.id === 'welcome'),
          {
            systemPrompt: SYSTEM_PROMPT,
            maxIterations: intent.maxIterations,
            toolNames: intent.toolNames,
          },
        ),
        REQUEST_TIMEOUT_MS,
        t('chat.timeout'),
      );

      const html = extractHtmlFromAgentOutput(assistantContent, messages);
      const errors = collectToolErrors(messages);
      const toolEvents = collectToolEvents(messages);
      const htmlQuality = html ? validateHtmlQuality(html, getLanguage()) : [];
      if (html) {
        usePreviewStore.getState().setGeneratedHtml(html, extractTitle(html) || 'AI HTML Preview');
      }
      const agentMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'agent',
        content: formatAssistantContent(assistantContent, html, errors, intent.htmlSkill, htmlQuality),
        timestamp: new Date().toISOString(),
        toolEvents,
      };

      let completed = false;
      set((s) => {
        if (s.activeRequestId !== requestId) return {};
        completed = true;
        return {
          messages: [...s.messages, agentMsg],
          isProcessing: false,
          processingSteps: [],
          activeRequestId: null,
          htmlDocument: html || s.htmlDocument,
        };
      });
      get().saveHistory();
      if (completed) drainQueuedRequest(set, get);
    } catch (e: unknown) {
      appendError(set, get, e, requestId);
    }
  },

  sendCommand: async (command, params) => {
    const state = get();
    if (!command.trim()) return;
    if (state.isProcessing) {
      queueRequest(set, {
        id: crypto.randomUUID(),
        kind: 'command',
        content: command,
        params,
        createdAt: new Date().toISOString(),
      });
      return;
    }

    const parsed = parseCommand(command);
    const intent = classifyIntent(command, false, Boolean(state.htmlDocument));
    const commandHtmlSkill = parsed.cmd === 'ai' || parsed.cmd === 'generate'
      ? selectHtmlSkill(parsed.rest, 'create')
      : parsed.cmd === 'theme' || parsed.cmd === 'style'
      ? selectHtmlSkill(parsed.rest, 'edit')
      : undefined;
    const commandParams = isRecord(params) ? params : {};
    const displayCommand = commandParams.path ? `${command} ${String(commandParams.path)}` : command;
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: displayCommand,
      timestamp: new Date().toISOString(),
    };
    const requestId = crypto.randomUUID();
    set({
      messages: [...state.messages, userMsg],
      inputValue: '',
      isProcessing: true,
      activeRequestId: requestId,
      processingSteps: createProcessingSteps(intent),
    });
    beginProcessingTimeline(set, get, requestId, intent);

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      let responseContent = '';
      let nextHtml: string | null = null;
      let workflowSteps: WorkflowStep[] | undefined;

      if (parsed.cmd === 'open') {
        const path = await resolveOpenPath(parsed.rest, commandParams);
        if (!path) {
          responseContent = t('chat.cancelled');
        } else {
          const doc = await withTimeout(usePreviewStore.getState().openFile(path, fileName(path)), REQUEST_TIMEOUT_MS, t('chat.timeout'));
          if (doc?.kind === 'html' && doc.content) {
            nextHtml = doc.content;
          }
          responseContent = doc
            ? `${doc.kind === 'html' ? t('chat.opened') : t('chat.openedFile')}\n${doc.name}`
            : t('chat.noDisplayableResult');
        }
      } else if (parsed.cmd === 'ai' || parsed.cmd === 'generate') {
        const topic = normalizeAiTopic(parsed.rest, commandParams);
        const slides = inferSlideCount(parsed.rest, commandParams);
        const result = await withTimeout(invoke('run_workflow', {
          command: 'ai',
          params: { topic, slides },
        }), REQUEST_TIMEOUT_MS, t('chat.timeout'));
        nextHtml = extractHtmlFromWorkflowResult(result);
        workflowSteps = extractWorkflowSteps(result);
        responseContent = nextHtml
          ? `${t('chat.generated')}\n${extractTitle(nextHtml) || topic}`
          : formatWorkflowResult(result);
      } else if (parsed.cmd === 'theme' || parsed.cmd === 'style') {
        if (!state.htmlDocument) throw new Error(t('chat.noHtmlDocument'));
        nextHtml = applyThemeLocally(state.htmlDocument, parsed.rest);
        responseContent = t('chat.updated');
      } else if (parsed.cmd === 'export') {
        if (!state.htmlDocument) throw new Error(t('chat.noHtmlDocument'));
        const format = normalizeExportFormat(parsed.rest, commandParams);
        if (format === 'png') {
          responseContent = t('editor.capturePng');
        } else if (format === 'video') {
          const result = await withTimeout(invoke('generate_video', { slideCount: 1, outputPath: null }), REQUEST_TIMEOUT_MS, t('chat.timeout'));
          responseContent = `${t('chat.exported')}\n${String(result)}`;
        } else {
          const result = await withTimeout(invoke('export_document', {
            html: state.htmlDocument,
            format,
            theme: null,
            outputPath: null,
          }), REQUEST_TIMEOUT_MS, t('chat.timeout'));
          responseContent = formatExportResult(result);
        }
      } else if (parsed.cmd === 'publish' || parsed.cmd === 'package') {
        if (!state.htmlDocument) throw new Error(t('chat.noHtmlDocument'));
        const result = await withTimeout(invoke('save_html', {
          html: state.htmlDocument,
          path: './output/index.html',
        }), REQUEST_TIMEOUT_MS, t('chat.timeout'));
        responseContent = `${t('chat.exported')}\n${String(result)}`;
      } else {
        const result = await withTimeout(invoke('run_workflow', {
          command: parsed.cmd,
          params: normalizeCommandParams(parsed.cmd, parsed.rest, commandParams),
        }), REQUEST_TIMEOUT_MS, t('chat.timeout'));
        nextHtml = extractHtmlFromWorkflowResult(result);
        workflowSteps = extractWorkflowSteps(result);
        responseContent = nextHtml ? t('chat.updated') : formatWorkflowResult(result);
      }

      if (nextHtml) {
        usePreviewStore.getState().setGeneratedHtml(nextHtml, extractTitle(nextHtml) || 'AI HTML Preview');
        if (commandHtmlSkill) {
          responseContent = `${responseContent}\n${summarizeHtmlQuality(
            validateHtmlQuality(nextHtml, getLanguage()),
            commandHtmlSkill,
            getLanguage(),
          )}`;
        }
      }

      const agentMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'agent',
        content: responseContent,
        timestamp: new Date().toISOString(),
        workflow: workflowSteps,
      };
      let completed = false;
      set((s) => {
        if (s.activeRequestId !== requestId) return {};
        completed = true;
        return {
          messages: [...s.messages, agentMsg],
          isProcessing: false,
          processingSteps: [],
          activeRequestId: null,
          htmlDocument: nextHtml || s.htmlDocument,
        };
      });
      get().saveHistory();
      if (completed) drainQueuedRequest(set, get);
    } catch (e: unknown) {
      appendError(set, get, e, requestId);
    }
  },

  stopProcessing: () => {
    const state = get();
    if (!state.isProcessing) return;
    const stopMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'system',
      content: t('chat.cancelled'),
      timestamp: new Date().toISOString(),
    };
    set((s) => ({
      messages: [...s.messages, stopMsg],
      isProcessing: false,
      processingSteps: [],
      queuedRequests: [],
      activeRequestId: null,
    }));
    get().saveHistory();
  },

  clearMessages: () => {
    set({ messages: [createWelcomeMessage()] });
    get().saveHistory();
  },

  setHtmlDocument: (html) => set({ htmlDocument: html }),

  saveMemory: (key, value) => {
    const memory = { ...get().conversationMemory, [key]: value };
    set({ conversationMemory: memory });
    try { localStorage.setItem(MEMORY_KEY, JSON.stringify(memory)); } catch {}
  },

  getMemory: (key) => get().conversationMemory[key],

  loadHistory: () => set({ messages: loadSavedMessages() }),

  saveHistory: () => {
    try {
      const msgs = get().messages.slice(-200);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs));
    } catch {}
  },
}));

type SetChatState = (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void;

interface AgentIntent {
  id: string;
  title: string;
  summary: string;
  toolNames: string[];
  maxIterations: number;
  wantsHtmlOutput: boolean;
  htmlSkill?: HtmlSkill;
}

function classifyIntent(content: string, hasImage: boolean, hasHtml: boolean): AgentIntent {
  const text = content.trim();
  const lower = text.toLowerCase();
  const zh = getLanguage() === 'zh';
  const createWords = /(生成|创建|做一个|做个|写一个|写个|设计|制作|页面|网页|html|动效|粒子|炫酷|landing|create|generate|make|build|design)/i;
  const editWords = /(修改|优化|改成|换成|调整|美化|润色|主题|风格|edit|update|change|theme|style|polish)/i;
  const exportWords = /(导出|输出|转成|转为|转换|发布|打包|export|convert|publish|package|pptx|markdown|\bmd\b|mp4|video|png|pdf)/i;
  const mediaWords = /(视频|音频|字幕|媒体|mp4|mov|webm|srt|vtt|video|audio|subtitle|media)/i;

  if (hasImage) {
    const htmlSkill = selectHtmlSkill(text, 'image');
    return {
      id: 'image-to-html',
      title: zh ? '图片理解' : 'Image understanding',
      summary: zh
        ? `先识别图片内容，再套用 ${skillLabel(htmlSkill, 'zh')} 输出高质量 HTML。`
        : `Read the image first, then use ${skillLabel(htmlSkill, 'en')} for high-quality HTML.`,
      toolNames: [],
      maxIterations: 1,
      wantsHtmlOutput: true,
      htmlSkill,
    };
  }

  const asksCreate = createWords.test(text);
  const asksEdit = hasHtml && editWords.test(text);
  const asksExportOnly = exportWords.test(text) && !asksCreate && !asksEdit;
  const asksMediaOnly = mediaWords.test(text) && !asksCreate && !asksEdit && !asksExportOnly;

  if (asksCreate || asksEdit) {
    const htmlSkill = selectHtmlSkill(text, asksEdit ? 'edit' : 'create');
    return {
      id: asksEdit ? 'edit-html' : 'generate-html',
      title: zh ? (asksEdit ? '修改 HTML' : '生成 HTML') : (asksEdit ? 'Edit HTML' : 'Generate HTML'),
      summary: zh
        ? `LLM 直接生成或修改 HTML，内置 ${skillLabel(htmlSkill, 'zh')} 质量约束，完成后自动刷新中间预览。`
        : `The LLM writes or edits HTML with the built-in ${skillLabel(htmlSkill, 'en')}, then the preview refreshes.`,
      toolNames: [],
      maxIterations: 1,
      wantsHtmlOutput: true,
      htmlSkill,
    };
  }

  if (asksExportOnly) {
    return {
      id: 'export-plan',
      title: zh ? '导出判断' : 'Export routing',
      summary: zh
        ? '先判断当前文档和目标格式，缺少条件时先追问，不盲目调用导出工具。'
        : 'Check the current document and target format first; ask if required data is missing.',
      toolNames: [],
      maxIterations: 1,
      wantsHtmlOutput: false,
    };
  }

  if (asksMediaOnly) {
    return {
      id: 'media-plan',
      title: zh ? '媒体判断' : 'Media routing',
      summary: zh
        ? '先确认媒体路径和操作目标；没有明确文件时不会调用媒体工具。'
        : 'Confirm the media path and goal first; no media tool runs without a concrete file.',
      toolNames: [],
      maxIterations: 1,
      wantsHtmlOutput: false,
    };
  }

  return {
    id: 'chat',
    title: zh ? '需求理解' : 'Understand request',
    summary: zh ? '普通对话或需求澄清，本轮不需要工具。' : 'Regular chat or clarification; no tools needed.',
    toolNames: [],
    maxIterations: 1,
    wantsHtmlOutput: false,
  };
}

function createProcessingSteps(intent: AgentIntent): ProcessingStep[] {
  const zh = getLanguage() === 'zh';
  const toolDetail = intent.toolNames.length > 0
    ? `${zh ? '仅开放工具：' : 'Allowed tools only: '}${intent.toolNames.join(', ')}`
    : (zh ? '本轮无需工具，避免无关工具链。' : 'No tools for this turn, avoiding unrelated tool calls.');
  const skillDetail = intent.htmlSkill
    ? `${zh ? '内置质量 Skill：' : 'Built-in quality skill: '}${skillLabel(intent.htmlSkill, getLanguage())}`
    : toolDetail;
  return [
    {
      id: 'understand',
      title: zh ? 'LLM 理解问题' : 'LLM understands',
      detail: intent.summary,
      status: 'active',
    },
    {
      id: 'route',
      title: zh ? 'Agent 编排' : 'Agent routing',
      detail: skillDetail,
      status: 'pending',
    },
    {
      id: 'execute',
      title: intent.toolNames.length > 0 ? (zh ? '执行工具轮' : 'Run tool turns') : (zh ? '直接生成结果' : 'Generate directly'),
      detail: intent.toolNames.length > 0
        ? (zh ? '按白名单顺序收集工具结果。' : 'Collect tool results from the whitelist.')
        : (zh ? '由 LLM 输出结果，缺信息时先追问。' : 'The LLM responds directly or asks a follow-up.'),
      status: 'pending',
    },
    {
      id: 'preview',
      title: intent.wantsHtmlOutput ? (zh ? '质量检查并预览' : 'Quality check and preview') : (zh ? '更新预览' : 'Update preview'),
      detail: intent.wantsHtmlOutput
        ? (zh ? '检查完整文档、viewport、样式、响应式和动效约束后写入中间预览。' : 'Check document structure, viewport, styles, responsiveness, and motion before preview.')
        : (zh ? '整理最终回复并保留上下文。' : 'Prepare the final reply and keep context.'),
      status: 'pending',
    },
  ];
}

function beginProcessingTimeline(
  set: SetChatState,
  get: () => ChatState,
  requestId: string,
  intent: AgentIntent,
) {
  const stepCount = createProcessingSteps(intent).length;
  const delays = [320, 850, 1450, 2200];
  for (let index = 1; index < stepCount; index += 1) {
    window.setTimeout(() => {
      if (get().activeRequestId !== requestId) return;
      set((s) => ({
        processingSteps: s.processingSteps.map((step, i) => ({
          ...step,
          status: i < index ? 'done' : i === index ? 'active' : 'pending',
        })),
      }));
    }, delays[index - 1] ?? 1200);
  }
}

function queueRequest(set: SetChatState, request: QueuedRequest) {
  set((s) => ({
    inputValue: '',
    queuedRequests: [...s.queuedRequests, request],
  }));
}

function drainQueuedRequest(set: SetChatState, get: () => ChatState) {
  window.setTimeout(() => {
    const state = get();
    if (state.isProcessing || state.queuedRequests.length === 0) return;
    const [next, ...rest] = state.queuedRequests;
    set({ queuedRequests: rest });
    if (next.kind === 'command') {
      void get().sendCommand(next.content, next.params);
      return;
    }
    void get().sendMessage(next.content, next.imageDataUrl);
  }, 80);
}

function buildPromptForIntent(content: string, html: string | null, intent: AgentIntent): string {
  const base = html ? withCurrentDocument(content, html) : content;
  if (!intent.wantsHtmlOutput) return base;
  const qualityPrompt = intent.htmlSkill ? buildHtmlSkillPrompt(intent.htmlSkill, getLanguage()) : '';

  return `${base}

When the request is to create or edit a page, return ONLY one complete <!DOCTYPE html> document with inline CSS and JavaScript if needed.
The HTML must be directly previewable in an iframe. Do not call tools unless the router has explicitly exposed one.

${qualityPrompt}`;
}

async function buildImagePrompt(content: string, imageDataUrl: string, htmlSkill?: HtmlSkill): Promise<string> {
  let ocrText = '';
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const savedPath = await invoke<string>('save_image', { dataUrl: imageDataUrl, index: 999 });
    const ocrResult = await invoke<{ text?: string }>('run_ocr', { imagePath: savedPath, engine: 'easyocr' });
    ocrText = (ocrResult?.text || '').trim();
  } catch {}

  const userIntent = content.trim();
  const hasSubstantialText = ocrText.length > 30;
  const hasSomeText = ocrText.length > 3;
  const qualityPrompt = htmlSkill ? `\n\n${buildHtmlSkillPrompt(htmlSkill, getLanguage())}` : '';

  if (hasSubstantialText) {
    return `I am sending a screenshot or document image.

OCR extracted:
"""
${ocrText}
"""

${userIntent || 'Generate a complete HTML page that faithfully reproduces the layout, colors, text hierarchy, and visual structure.'}

Return a complete <!DOCTYPE html> document with inline CSS.${qualityPrompt}`;
  }

  if (hasSomeText) {
    return `I am sending a marketing image.

OCR found:
"""
${ocrText}
"""

${userIntent || 'Create a complete marketing landing page inspired by this image.'}

Return a complete <!DOCTYPE html> document with inline CSS.${qualityPrompt}`;
  }

  return `${userIntent || 'Analyze the image intent and create a visually polished landing page.'}

No substantial OCR text was found. Create a complete responsive <!DOCTYPE html> document with inline CSS.${qualityPrompt}`;
}

function withCurrentDocument(content: string, html: string | null): string {
  if (!html) return content;
  const clipped = html.length > 12000 ? `${html.slice(0, 12000)}\n<!-- truncated -->` : html;
  return `${content}

Current HTML document available for editing:
\`\`\`html
${clipped}
\`\`\``;
}

function parseCommand(command: string): { cmd: string; rest: string } {
  const text = command.trim().replace(/^\//, '');
  const firstSpace = text.search(/\s/);
  if (firstSpace === -1) return { cmd: text.toLowerCase(), rest: '' };
  return {
    cmd: text.slice(0, firstSpace).toLowerCase(),
    rest: text.slice(firstSpace + 1).trim(),
  };
}

async function resolveOpenPath(rest: string, params: Record<string, unknown>): Promise<string | null> {
  if (typeof params.path === 'string' && params.path.trim()) return params.path;
  const cleaned = stripQuotes(rest);
  if (cleaned) return cleaned;

  const { open } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    multiple: false,
    filters: [{ name: 'HTML / Video / PDF / Markdown / Image', extensions: PREVIEWABLE_EXTENSIONS }],
  });
  return typeof selected === 'string' ? selected : null;
}

function normalizeAiTopic(rest: string, params: Record<string, unknown>): string {
  if (typeof params.topic === 'string' && params.topic.trim()) return params.topic;
  const text = rest.replace(/^generate\s+/i, '').trim();
  return text || 'HTML marketing page';
}

function inferSlideCount(rest: string, params: Record<string, unknown>): number {
  if (typeof params.slides === 'number') return params.slides;
  const match = rest.match(/\b(\d{1,2})\b/);
  const count = match ? Number(match[1]) : 5;
  return Math.max(1, Math.min(count, 12));
}

function normalizeExportFormat(rest: string, params: Record<string, unknown>): string {
  if (typeof params.format === 'string' && params.format.trim()) return params.format.toLowerCase();
  return (rest.split(/\s+/)[0] || 'pptx').toLowerCase();
}

function normalizeCommandParams(cmd: string, rest: string, params: Record<string, unknown>): Record<string, unknown> {
  if (cmd === 'ocr') return { image_path: rest, engine: 'easyocr', ...params };
  if (cmd === 'media') return { path: rest, ...params };
  return { text: rest, ...params };
}

function extractHtmlFromAgentOutput(assistantContent: string, messages: LlmMessage[]): string | null {
  for (const msg of [...messages].reverse()) {
    if (msg.role !== 'tool' || !msg.content) continue;
    const parsed = tryParseJson(msg.content);
    const html = extractHtmlFromValue(parsed ?? msg.content);
    if (html) return html;
  }
  return extractHtmlFromText(assistantContent);
}

function extractHtmlFromWorkflowResult(result: unknown): string | null {
  if (Array.isArray(result)) {
    for (const step of result) {
      if (!isRecord(step)) continue;
      const html = extractHtmlFromValue(step.result);
      if (html) return html;
    }
  }
  return extractHtmlFromValue(result);
}

function extractHtmlFromValue(value: unknown): string | null {
  if (typeof value === 'string') return extractHtmlFromText(value);
  if (Array.isArray(value)) {
    const htmlFragments = value
      .filter((item): item is string => typeof item === 'string')
      .filter((item) => looksLikeHtml(item));
    if (htmlFragments.length > 0) return toCompleteHtml(htmlFragments.join('\n'));

    for (const item of value) {
      const html = extractHtmlFromValue(item);
      if (html) return html;
    }
    return null;
  }
  if (!isRecord(value)) return null;

  for (const key of ['html_content', 'styled_html', 'enhanced_html', 'html', 'content']) {
    const html = extractHtmlFromValue(value[key]);
    if (html) return html;
  }

  if (Array.isArray(value.slides)) {
    const slides = value.slides.filter((item): item is string => typeof item === 'string');
    if (slides.length > 0) return toCompleteHtml(slides.join('\n'));
  }

  for (const nested of Object.values(value)) {
    if (isRecord(nested) || Array.isArray(nested)) {
      const html = extractHtmlFromValue(nested);
      if (html) return html;
    }
  }
  return null;
}

function extractHtmlFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  const htmlFence = trimmed.match(/```html\s*([\s\S]*?)```/i);
  const anyFence = trimmed.match(/```\s*([\s\S]*?)```/);
  const candidate = (htmlFence?.[1] || anyFence?.[1] || trimmed).trim();
  return looksLikeHtml(candidate) ? toCompleteHtml(candidate) : null;
}

function looksLikeHtml(value: string): boolean {
  return /<!doctype html|<html[\s>]|<body[\s>]|<section[\s>]|<main[\s>]|<div[\s>]/i.test(value)
    && /<\/[a-z][\s\S]*>/i.test(value);
}

function toCompleteHtml(html: string): string {
  if (/<!doctype html|<html[\s>]/i.test(html)) return html;
  return `<!DOCTYPE html>
<html lang="${getLanguage()}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SeeHTML AI Output</title>
  <style>
    body { margin: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f8fafc; color: #0f172a; }
    .slide, section { min-height: 100vh; box-sizing: border-box; padding: 64px; }
  </style>
</head>
<body>
${html}
</body>
</html>`;
}

function formatAssistantContent(
  assistantContent: string,
  html: string | null,
  errors: string[],
  htmlSkill?: HtmlSkill,
  htmlQuality: HtmlQualityCheck[] = [],
): string {
  if (errors.length > 0) return `${getLanguage() === 'zh' ? '工具执行失败：' : 'Tool execution failed:'}\n${errors[0]}`;

  const clean = assistantContent.trim();
  if (html) {
    const qualitySummary = htmlQuality.length > 0
      ? `\n${summarizeHtmlQuality(htmlQuality, htmlSkill, getLanguage())}`
      : '';
    const contentIsHtml = Boolean(extractHtmlFromText(clean));
    if (!clean || contentIsHtml || isGenericCompletion(clean) || clean.length > 2000) {
      return `${t('chat.generated')}${qualitySummary}`;
    }
    return `${clean}${qualitySummary}`;
  }

  if (clean && !isGenericCompletion(clean)) return clean;
  return t('chat.noDisplayableResult');
}

function formatWorkflowResult(result: unknown): string {
  const error = extractError(result);
  if (error) return `${getLanguage() === 'zh' ? '执行失败：' : 'Failed:'}\n${error}`;

  const html = extractHtmlFromWorkflowResult(result);
  if (html) return t('chat.updated');

  const path = extractPath(result);
  if (path) return `${t('chat.exported')}\n${path}`;

  const message = extractMessage(result);
  if (message) return message;

  return t('chat.noDisplayableResult');
}

function formatExportResult(result: unknown): string {
  const path = extractPath(result);
  if (path) return `${t('chat.exported')}\n${path}`;
  const error = extractError(result);
  if (error) return `${getLanguage() === 'zh' ? '导出失败：' : 'Export failed:'}\n${error}`;
  return t('chat.exported');
}

function collectToolEvents(messages: LlmMessage[]): AgentToolEvent[] {
  const events: AgentToolEvent[] = [];
  const byId = new Map<string, AgentToolEvent>();

  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls) {
      for (const call of msg.tool_calls) {
        const id = call.id || crypto.randomUUID();
        const event: AgentToolEvent = {
          id,
          name: call.name,
          arguments: call.arguments,
        };
        events.push(event);
        byId.set(id, event);
      }
    }

    if (msg.role === 'tool') {
      const id = msg.tool_call_id || crypto.randomUUID();
      const event = byId.get(id) || {
        id,
        name: msg.name || 'tool',
      };
      const parsed = msg.content ? tryParseJson(msg.content) : null;
      const result = parsed ?? msg.content ?? '';
      event.result = result;
      const error = extractError(result);
      if (error) event.error = error;
      if (!byId.has(id)) {
        events.push(event);
        byId.set(id, event);
      }
    }
  }

  return events;
}

function collectToolErrors(messages: LlmMessage[]): string[] {
  const errors: string[] = [];
  for (const msg of messages) {
    if (msg.role !== 'tool' || !msg.content) continue;
    const parsed = tryParseJson(msg.content);
    const error = extractError(parsed);
    if (error) errors.push(error);
  }
  return errors;
}

function extractWorkflowSteps(result: unknown): WorkflowStep[] | undefined {
  if (!Array.isArray(result)) return undefined;
  const steps = result.filter(isWorkflowStep);
  return steps.length > 0 ? steps : undefined;
}

function extractError(value: unknown): string | null {
  if (typeof value === 'string') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const error = extractError(item);
      if (error) return error;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  if (typeof value.error === 'string') return value.error;
  if (isRecord(value.status) && typeof value.status.Failed === 'string') return value.status.Failed;
  if (typeof value.status === 'string' && value.status.toLowerCase().startsWith('failed')) return value.status;
  for (const nested of Object.values(value)) {
    const error = extractError(nested);
    if (error) return error;
  }
  return null;
}

function extractPath(value: unknown): string | null {
  if (typeof value === 'string') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const path = extractPath(item);
      if (path) return path;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const key of ['output_path', 'package_path', 'path']) {
    if (typeof value[key] === 'string' && value[key]) return value[key];
  }
  for (const nested of Object.values(value)) {
    const path = extractPath(nested);
    if (path) return path;
  }
  return null;
}

function extractMessage(value: unknown): string | null {
  if (typeof value === 'string') return value.length < 500 ? value : null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const message = extractMessage(item);
      if (message) return message;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  if (typeof value.message === 'string') return value.message;
  for (const nested of Object.values(value)) {
    const message = extractMessage(nested);
    if (message) return message;
  }
  return null;
}

function applyThemeLocally(html: string, instructions: string): string {
  const lower = instructions.toLowerCase();
  const dark = lower.includes('dark') || instructions.includes('深色') || instructions.includes('暗色');
  const primary = lower.includes('green') || instructions.includes('绿色') ? '#16a34a'
    : lower.includes('purple') || instructions.includes('紫') ? '#7c3aed'
    : lower.includes('red') || instructions.includes('红') ? '#dc2626'
    : '#2563eb';
  const bg = dark ? '#0f172a' : '#f8fafc';
  const fg = dark ? '#e2e8f0' : '#0f172a';
  const css = `<style id="seehtml-theme">
    :root { color-scheme: ${dark ? 'dark' : 'light'}; --seehtml-primary: ${primary}; }
    body { background: ${bg}; color: ${fg}; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    h1, h2, h3, a { color: var(--seehtml-primary); }
    button, .btn, [role="button"] { background: var(--seehtml-primary); color: #fff; }
  </style>`;

  const withoutOldTheme = html.replace(/<style id=["']seehtml-theme["'][\s\S]*?<\/style>/i, '');
  if (withoutOldTheme.includes('</head>')) {
    return withoutOldTheme.replace('</head>', `${css}</head>`);
  }
  return toCompleteHtml(`${css}${withoutOldTheme}`);
}

function extractTitle(html: string): string | null {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  return title ? stripTags(title).trim() : null;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function stripQuotes(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '');
}

function tryParseJson(value: string): unknown | null {
  try { return JSON.parse(value); } catch { return null; }
}

function isGenericCompletion(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/[.!。！\s]/g, '');
  return ['taskcompleted', 'completed', 'done', '任务完成', '已完成'].includes(normalized);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isWorkflowStep(value: unknown): value is WorkflowStep {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.agent === 'string'
    && typeof value.action === 'string'
    && 'status' in value
    && 'result' in value;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function appendError(
  set: SetChatState,
  get: () => ChatState,
  e: unknown,
  requestId?: string,
) {
  const em = e instanceof Error ? e.message : String(e);
  const errMsg: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'system',
    content: `Error: ${em}`,
    timestamp: new Date().toISOString(),
  };
  let completed = false;
  set((s) => {
    if (requestId && s.activeRequestId !== requestId) return {};
    completed = true;
    return {
      messages: [...s.messages, errMsg],
      isProcessing: false,
      processingSteps: [],
      activeRequestId: null,
    };
  });
  get().saveHistory();
  if (completed) drainQueuedRequest(set, get);
}
