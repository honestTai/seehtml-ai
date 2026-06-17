import { create } from 'zustand';
import type { AgentToolEvent, ChatMessage, ProcessingStep, QueuedRequest, WorkflowStep } from '../types';
import { runAgentLoop, type AgentExecutionPlan, type LlmMessage } from '../lib/agentLoop';
import { getLanguage, t, type Lang } from '../lib/i18n';
import {
  notifyProjectFilesChanged,
  projectExportDir,
  projectExportPath,
  projectHtmlPath,
} from '../lib/projectPaths';
import { PREVIEWABLE_EXTENSIONS, usePreviewStore } from './previewStore';
import { useUIStore } from './uiStore';
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
const SESSION_STORAGE_KEY = 'seehtml-chat-sessions-v1';
const MEMORY_KEY = 'seehtml-memory';
const REQUEST_TIMEOUT_MS = 180_000;
const MAX_SESSION_MESSAGES = 200;

export interface ChatSession {
  id: string;
  title: string;
  projectPath: string | null;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

interface ChatState {
  messages: ChatMessage[];
  sessions: ChatSession[];
  activeSessionId: string | null;
  inputValue: string;
  isProcessing: boolean;
  processingSteps: ProcessingStep[];
  queuedRequests: QueuedRequest[];
  activeRequestId: string | null;
  htmlDocument: string | null;
  conversationMemory: Record<string, string>;
  setInputValue: (v: string) => void;
  addMessage: (msg: ChatMessage) => void;
  sendMessage: (content: string, imageDataUrls?: string | string[]) => Promise<void>;
  sendCommand: (command: string, params?: unknown) => Promise<void>;
  stopProcessing: () => void;
  clearMessages: () => void;
  newSession: (projectPath?: string | null) => void;
  switchSession: (id: string) => void;
  ensureProjectSession: (projectPath: string) => void;
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

const SYSTEM_PROMPT = `You are SeeHTML AI, a Codex-like agent for local HTML projects.
You have a planning role before execution. The client route, selected quality profile, and visible tools are hints, not hard boundaries.
For every turn, first decide whether the user wants: clarification, normal chat, HTML creation/editing, local file/project work, export, or media processing.
If the request is vague, especially "make it better", "adjust it", "do a page", or unclear export/edit scope, ask exactly one concise follow-up question and offer 2-5 short options. Do not fabricate requirements.
Use available tools only when they clearly help and required inputs are present. Do not call export/media tools merely because they exist.
Never create or render MP4 unless the user explicitly asks to export/render/generate/convert MP4 or video.
If the user asks to create or edit HTML and the intent is clear, return one complete usable <!DOCTYPE html> document with inline CSS/JS, or use tools if they are better for the task.
If a tool is unavailable or not needed, answer directly. Never answer only "Task completed"; state the concrete result.
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

function createChatSession(
  projectPath: string | null,
  title = t('sessions.untitled'),
  messages: ChatMessage[] = [createWelcomeMessage()],
): ChatSession {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title,
    projectPath,
    messages,
    createdAt: now,
    updatedAt: now,
  };
}

function loadSavedSessionState(): { sessions: ChatSession[]; activeSessionId: string } {
  try {
    const saved = localStorage.getItem(SESSION_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as { activeSessionId?: unknown; sessions?: unknown };
      const sessions = Array.isArray(parsed.sessions)
        ? parsed.sessions.map(normalizeSession).filter((item): item is ChatSession => Boolean(item))
        : [];
      if (sessions.length > 0) {
        const activeSessionId = typeof parsed.activeSessionId === 'string'
          && sessions.some((session) => session.id === parsed.activeSessionId)
          ? parsed.activeSessionId
          : sessions[0].id;
        return { sessions, activeSessionId };
      }
    }
  } catch {}

  const projectPath = useUIStore.getState().projectPath;
  const migrated = createChatSession(projectPath, t('sessions.current'), loadSavedMessages());
  return { sessions: [migrated], activeSessionId: migrated.id };
}

function normalizeSession(value: unknown): ChatSession | null {
  if (!isRecord(value)) return null;
  const messages = Array.isArray(value.messages)
    ? value.messages.filter(isChatMessage).slice(-MAX_SESSION_MESSAGES)
    : [createWelcomeMessage()];
  const id = typeof value.id === 'string' && value.id ? value.id : crypto.randomUUID();
  const title = typeof value.title === 'string' && value.title.trim() ? value.title : t('sessions.untitled');
  const projectPath = typeof value.projectPath === 'string' && value.projectPath.trim() ? value.projectPath : null;
  const createdAt = typeof value.createdAt === 'string' ? value.createdAt : new Date().toISOString();
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : createdAt;
  return { id, title, projectPath, messages, createdAt, updatedAt };
}

function isChatMessage(value: unknown): value is ChatMessage {
  return isRecord(value)
    && typeof value.id === 'string'
    && (value.role === 'user' || value.role === 'agent' || value.role === 'system')
    && typeof value.content === 'string'
    && typeof value.timestamp === 'string';
}

function activeSessionMessages(sessions: ChatSession[], activeSessionId: string): ChatMessage[] {
  return sessions.find((session) => session.id === activeSessionId)?.messages || [createWelcomeMessage()];
}

function sessionTitleFromMessages(existingTitle: string, messages: ChatMessage[]): string {
  const untitled = [t('sessions.untitled'), t('sessions.current'), 'Untitled', 'Current session', '新会话', '当前会话'];
  if (existingTitle.trim() && !untitled.includes(existingTitle.trim())) return existingTitle;
  const firstUser = messages.find((message) => message.role === 'user' && message.content.trim());
  if (!firstUser) return t('sessions.untitled');
  const normalized = firstUser.content.replace(/\s+/g, ' ').trim();
  return normalized.length > 24 ? `${normalized.slice(0, 24)}...` : normalized;
}

function syncActiveSessionSnapshot(state: ChatState): ChatSession[] {
  const activeSessionId = state.activeSessionId;
  if (!activeSessionId) return state.sessions;
  const currentProjectPath = useUIStore.getState().projectPath;
  const messages = state.messages.slice(-MAX_SESSION_MESSAGES);
  const now = new Date().toISOString();
  return state.sessions.map((session) => {
    if (session.id !== activeSessionId) return session;
    const projectPath = session.projectPath || currentProjectPath || null;
    return {
      ...session,
      projectPath,
      messages,
      title: sessionTitleFromMessages(session.title, messages),
      updatedAt: now,
    };
  });
}

function persistSessions(sessions: ChatSession[], activeSessionId: string | null): void {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
      activeSessionId,
      sessions: sessions.slice(0, 80),
    }));
  } catch {}
}

function loadMemory(): Record<string, string> {
  try {
    const saved = localStorage.getItem(MEMORY_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return {};
}

const initialSessionState = loadSavedSessionState();

export const useChatStore = create<ChatState>((set, get) => ({
  messages: activeSessionMessages(initialSessionState.sessions, initialSessionState.activeSessionId),
  sessions: initialSessionState.sessions,
  activeSessionId: initialSessionState.activeSessionId,
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

  sendMessage: async (content: string, imageDataUrls?: string | string[]) => {
    const state = get();
    const images = normalizeImageDataUrls(imageDataUrls);
    if (!content.trim() && images.length === 0) return;
    if (state.isProcessing) {
      queueRequest(set, {
        id: crypto.randomUUID(),
        kind: 'message',
        content,
        imageDataUrl: images[0],
        imageDataUrls: images,
        createdAt: new Date().toISOString(),
      });
      return;
    }

    const displayContent = content.trim() || (images.length > 1 ? t('chat.imagesDefault') : t('chat.imageDefault'));
    const intent = classifyIntent(content, images.length > 0, Boolean(state.htmlDocument));
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: displayContent,
      imageDataUrl: images[0],
      imageDataUrls: images,
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
    get().saveHistory();
    beginProcessingTimeline(set, get, requestId, intent);

    try {
      const projectPath = requireProjectForIntent(intent, images.length > 0);

      if (intent.wantsVideoExport && !intent.wantsHtmlOutput) {
        const previewDoc = usePreviewStore.getState().document;
        const currentHtml = state.htmlDocument || (previewDoc?.kind === 'html' ? previewDoc.content : null);
        if (!currentHtml) throw new Error(t('chat.noHtmlDocument'));
        usePreviewStore.getState().requestRender({
          type: 'mp4',
          pageCount: intent.requestedPages,
          reason: content,
        });
        const agentMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'agent',
        content: t('export.mp4BackgroundRunning'),
        timestamp: new Date().toISOString(),
        workflow: buildWorkflowForIntent(intent),
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
          };
        });
        get().saveHistory();
        if (completed) drainQueuedRequest(set, get);
        return;
      }

      const prompt = images.length > 0
        ? await withTimeout(buildImagePrompt(content, images, intent, projectPath), REQUEST_TIMEOUT_MS, t('chat.timeout'))
        : buildPromptForIntent(content, state.htmlDocument, intent, projectPath);

      const { assistantContent, messages, plan } = await withTimeout(
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
      let savedHtmlPath: string | null = null;
      if (html) {
        savedHtmlPath = await saveHtmlToProject(html, projectPath);
        if (intent.wantsVideoExport) {
          usePreviewStore.getState().requestRender({
            type: 'mp4',
            pageCount: intent.requestedPages,
            reason: content,
          });
        }
      }
      const agentMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'agent',
        content: withSavedPath(
          formatAssistantContent(assistantContent, html, errors, intent.htmlSkill, htmlQuality),
          savedHtmlPath,
        ),
        timestamp: new Date().toISOString(),
        toolEvents,
        workflow: buildWorkflowForIntent(intent, plan),
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
    get().saveHistory();
    beginProcessingTimeline(set, get, requestId, intent);

    try {
      const projectPath = requireProjectForCommand(parsed.cmd);
      const { invoke } = await import('@tauri-apps/api/core');
      let responseContent = '';
      let nextHtml: string | null = null;
      let savedHtmlPath: string | null = null;
      let workflowSteps: WorkflowStep[] | undefined;

      if (parsed.cmd === 'open') {
        const path = await resolveOpenPath(parsed.rest, commandParams);
        if (!path) {
          responseContent = t('chat.cancelled');
        } else {
          const doc = await withTimeout(usePreviewStore.getState().openFile(path, fileName(path)), REQUEST_TIMEOUT_MS, t('chat.timeout'));
          if (doc) {
            showDocumentInWorkspace(path, doc.kind);
          }
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
          usePreviewStore.getState().requestRender({
            type: 'mp4',
            reason: command,
          });
          responseContent = t('export.mp4BackgroundRunning');
        } else {
          const ext = format === 'markdown' || format === 'md' ? 'md' : format;
          const result = await withTimeout(invoke('export_document', {
            html: state.htmlDocument,
            format,
            theme: null,
            outputPath: projectExportPath(projectPath, `document.${ext}`),
          }), REQUEST_TIMEOUT_MS, t('chat.timeout'));
          notifyProjectFilesChanged(projectPath);
          responseContent = formatExportResult(result);
        }
      } else if (parsed.cmd === 'publish' || parsed.cmd === 'package') {
        if (!state.htmlDocument) throw new Error(t('chat.noHtmlDocument'));
        const result = await withTimeout(invoke('save_html', {
          html: state.htmlDocument,
          path: projectHtmlPath(projectPath),
        }), REQUEST_TIMEOUT_MS, t('chat.timeout'));
        notifyProjectFilesChanged(projectPath);
        const doc = await usePreviewStore.getState().openFile(String(result), fileName(String(result)));
        if (doc) {
          showDocumentInWorkspace(String(result), doc.kind);
        }
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
        savedHtmlPath = await saveHtmlToProject(nextHtml, projectPath);
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
        content: withSavedPath(responseContent, savedHtmlPath),
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
    get().newSession(useUIStore.getState().projectPath);
  },

  newSession: (projectPath) => {
    if (get().isProcessing) return;
    const synced = syncActiveSessionSnapshot(get());
    const next = createChatSession(projectPath ?? useUIStore.getState().projectPath ?? null);
    const sessions = [next, ...synced].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    set({
      sessions,
      activeSessionId: next.id,
      messages: next.messages,
      inputValue: '',
      queuedRequests: [],
      processingSteps: [],
      activeRequestId: null,
    });
    persistSessions(sessions, next.id);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next.messages)); } catch {}
  },

  switchSession: (id) => {
    if (get().isProcessing) return;
    const synced = syncActiveSessionSnapshot(get());
    const target = synced.find((session) => session.id === id);
    if (!target) return;
    const sessions = synced.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    set({
      sessions,
      activeSessionId: id,
      messages: target.messages,
      inputValue: '',
      queuedRequests: [],
      processingSteps: [],
      activeRequestId: null,
    });
    persistSessions(sessions, id);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(target.messages)); } catch {}
  },

  ensureProjectSession: (projectPath) => {
    if (!projectPath || get().isProcessing) return;
    const synced = syncActiveSessionSnapshot(get());
    const existing = [...synced]
      .filter((session) => samePath(session.projectPath, projectPath))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    const target = existing || createChatSession(projectPath);
    const sessions = existing
      ? synced
      : [target, ...synced];
    const sorted = sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    set({
      sessions: sorted,
      activeSessionId: target.id,
      messages: target.messages,
      inputValue: '',
    });
    persistSessions(sorted, target.id);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(target.messages)); } catch {}
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
      const state = get();
      const msgs = state.messages.slice(-MAX_SESSION_MESSAGES);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs));
      const sessions = syncActiveSessionSnapshot(state).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      set({ sessions });
      persistSessions(sessions, state.activeSessionId);
    } catch {}
  },
}));

type SetChatState = (partial: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => void;

interface AgentIntent {
  id: string;
  title: string;
  summary: string;
  toolNames?: string[];
  maxIterations: number;
  wantsHtmlOutput: boolean;
  requestedPages?: number;
  wantsAnimation?: boolean;
  wantsVideoExport?: boolean;
  htmlSkill?: HtmlSkill;
  needsClarification?: boolean;
  clarificationQuestion?: string;
  clarificationOptions?: string[];
}

function classifyIntent(content: string, hasImage: boolean, hasHtml: boolean): AgentIntent {
  const text = content.trim();
  const lower = text.toLowerCase();
  const zh = getLanguage() === 'zh';
  const requestedPages = inferPageCountFromText(text);
  const wantsAnimation = /(动画|动效|运动|自动渲染|逐页渲染|粒子|转场|animate|animated|animation|motion|transition)/i.test(text);
  const wantsVideoExport = isExplicitMp4ExportRequest(text);
  const createWords = /(生成|创建|做一个|做个|写一个|写个|设计|制作|页面|网页|html|动效|粒子|炫酷|landing|create|generate|make|build|design)/i;
  const htmlCreationWords = /(页面|网页|html|动效|动画|粒子|炫酷|landing|page|site|web|html|animate|animation|motion|design)/i;
  const editWords = /(修改|优化|改成|换成|调整|美化|润色|重做|重新弄|重新做|主题|风格|edit|update|change|theme|style|polish|redo|rework)/i;
  const exportWords = /(导出|输出|转成|转为|转换|发布|打包|export|convert|publish|package|pptx|markdown|\bmd\b|png|pdf)/i;
  const mediaWords = /(视频|音频|字幕|媒体|mp4|mov|webm|srt|vtt|video|audio|subtitle|media)/i;

  if (hasImage) {
    const htmlSkill = selectHtmlSkill(text, 'image');
    return {
      id: 'image-to-html',
      title: zh ? '图片理解' : 'Image understanding',
      summary: zh
        ? `先识别图片内容${requestedPages ? `，按 ${requestedPages} 页` : ''}，再套用 ${skillLabel(htmlSkill, 'zh')} 输出高质量 HTML。`
        : `Read the image first${requestedPages ? `, create ${requestedPages} pages` : ''}, then use ${skillLabel(htmlSkill, 'en')} for high-quality HTML.`,
      maxIterations: 6,
      wantsHtmlOutput: true,
      requestedPages,
      wantsAnimation,
      wantsVideoExport,
      htmlSkill,
    };
  }

  const asksCreate = createWords.test(text) && !(wantsVideoExport && hasHtml && !htmlCreationWords.test(text));
  const asksEdit = hasHtml && editWords.test(text);
  const asksExportOnly = exportWords.test(text) && !asksCreate && !asksEdit;
  const asksMediaOnly = mediaWords.test(text) && !asksCreate && !asksEdit && !asksExportOnly;

  if (asksCreate || asksEdit) {
    if (asksCreate && isVagueCreateRequest(text)) {
      return clarificationIntent(
        zh ? '页面目标不够明确' : 'Page goal is unclear',
        zh ? '要先确认页面主题和风格，再生成 HTML。' : 'Confirm the page topic and style before generating HTML.',
        zh ? '你想做什么主题的 HTML？' : 'What should this HTML be about?',
        zh
          ? ['营销/产品页', '演示/PPT 页', 'Canvas 动画页', '打开现有 HTML 再改']
          : ['Landing/product page', 'Slide/deck page', 'Canvas animation', 'Open existing HTML first'],
      );
    }
    if (asksEdit && isVagueEditRequest(text)) {
      return clarificationIntent(
        zh ? '修改范围不够明确' : 'Edit scope is unclear',
        zh ? '需要先确认具体改哪里，避免把现有页面改偏。' : 'Confirm the edit scope before changing the current page.',
        zh ? '你想重点改哪一块？' : 'What should I focus on changing?',
        zh
          ? ['整体 UI 质感', '布局结构', '颜色/字体', '动画/交互']
          : ['Overall UI polish', 'Layout structure', 'Color/typography', 'Motion/interaction'],
      );
    }
    const htmlSkill = selectHtmlSkill(text, asksEdit ? 'edit' : 'create');
    return {
      id: asksEdit ? 'edit-html' : 'generate-html',
      title: zh ? (asksEdit ? '修改 HTML' : '生成 HTML') : (asksEdit ? 'Edit HTML' : 'Generate HTML'),
      summary: zh
        ? `LLM 按需求${requestedPages ? `生成 exactly ${requestedPages} 页` : '生成或修改 HTML'}，内置 ${skillLabel(htmlSkill, 'zh')} 质量约束，完成后刷新 HTML 预览${wantsVideoExport ? '，并把 MP4 放到后台渲染' : ''}。`
        : `The LLM writes or edits HTML${requestedPages ? ` as exactly ${requestedPages} pages` : ''} with ${skillLabel(htmlSkill, 'en')}, then the HTML preview refreshes${wantsVideoExport ? ' and MP4 rendering runs in the background' : ''}.`,
      maxIterations: 8,
      wantsHtmlOutput: true,
      requestedPages,
      wantsAnimation,
      wantsVideoExport,
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
      maxIterations: 6,
      wantsHtmlOutput: false,
      requestedPages,
      wantsAnimation,
      wantsVideoExport,
    };
  }

  if (asksMediaOnly) {
    return {
      id: 'media-plan',
      title: zh ? '媒体判断' : 'Media routing',
      summary: zh
        ? '先确认媒体路径和操作目标；没有明确文件时不会调用媒体工具。'
        : 'Confirm the media path and goal first; no media tool runs without a concrete file.',
      maxIterations: 6,
      wantsHtmlOutput: false,
      requestedPages,
      wantsAnimation,
      wantsVideoExport,
    };
  }

  return {
    id: 'chat',
    title: zh ? '需求理解' : 'Understand request',
    summary: zh ? '普通对话或需求澄清，本轮不需要工具。' : 'Regular chat or clarification; no tools needed.',
    maxIterations: 6,
    wantsHtmlOutput: false,
    requestedPages,
    wantsAnimation,
    wantsVideoExport,
  };
}

function isExplicitMp4ExportRequest(text: string): boolean {
  const actionBeforeFormat = /(?:导出|输出|生成|制作|渲染|合成|转成|转为|转换|做一个|做个|encode|export|render|generate|create|make|convert).{0,18}(?:mp4|视频|video)/i;
  const formatBeforeAction = /(?:mp4|视频|video).{0,18}(?:导出|输出|生成|制作|渲染|合成|转成|转为|转换|encode|export|render|generate|create|make|convert)/i;
  return actionBeforeFormat.test(text) || formatBeforeAction.test(text);
}

function isVagueCreateRequest(text: string): boolean {
  const normalized = text
    .replace(/[，。,.!！?？]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const genericOnly = /^(帮我|给我|请|麻烦)?\s*(生成|创建|做一个|做个|写一个|写个|设计|制作|create|generate|make|build|design)\s*(一个|个|a|an)?\s*(html|页面|网页|page|website)?\s*$/i;
  if (genericOnly.test(normalized)) return true;
  const hasSpecificNoun = /关于|主题|风格|产品|品牌|公司|活动|课程|报告|登录|注册|仪表盘|个人|官网|营销|动画|粒子|星空|量子|AI|SaaS|CRM|电商|教育|医疗|金融|旅游|游戏|portfolio|landing|dashboard|login|signup|product|brand|animation|canvas/i.test(normalized);
  return normalized.length <= 12 && !hasSpecificNoun;
}

function isVagueEditRequest(text: string): boolean {
  const normalized = text
    .replace(/[，。,.!！?？]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const genericEdit = /^(帮我|给我|请|麻烦)?\s*(改一下|改改|调整一下|优化一下|美化一下|润色一下|弄好看点|重新弄|重新做|重做|edit|update|improve|polish|redo|rework|make it better)\s*$/i;
  if (genericEdit.test(normalized)) return true;
  const hasSpecificScope = /颜色|字体|布局|间距|动画|交互|按钮|导航|侧边栏|预览|文件树|面包屑|导出|MP4|暗色|浅色|移动端|响应式|color|font|layout|spacing|motion|animation|button|sidebar|preview|breadcrumb|export|responsive/i.test(normalized);
  return normalized.length <= 10 && !hasSpecificScope;
}

function clarificationIntent(
  title: string,
  summary: string,
  question: string,
  options: string[],
): AgentIntent {
  return {
    id: 'clarify',
    title,
    summary,
    maxIterations: 1,
    wantsHtmlOutput: false,
    needsClarification: true,
    clarificationQuestion: question,
    clarificationOptions: options,
  };
}

function inferPageCountFromText(text: string): number | undefined {
  const numericMatch = text.match(/(?:^|[^\d])(\d{1,2})\s*(?:页|页面|p|page|pages|slide|slides|张|屏)/i);
  if (numericMatch) {
    const value = Number(numericMatch[1]);
    if (Number.isFinite(value)) return Math.max(1, Math.min(value, 24));
  }

  const zhMatch = text.match(/([一二两三四五六七八九十]{1,3})\s*(?:页|页面|张|屏)/);
  if (zhMatch) {
    const value = parseChineseCount(zhMatch[1]);
    if (value) return Math.max(1, Math.min(value, 24));
  }

  return undefined;
}

function parseChineseCount(value: string): number | undefined {
  const digits: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (value === '十') return 10;
  if (value.includes('十')) {
    const [left, right] = value.split('十');
    const tens = left ? digits[left] || 0 : 1;
    const ones = right ? digits[right] || 0 : 0;
    const total = tens * 10 + ones;
    return total > 0 ? total : undefined;
  }
  return digits[value];
}

function createProcessingSteps(intent: AgentIntent): ProcessingStep[] {
  const zh = getLanguage() === 'zh';
  if (!isOrchestrationIntent(intent)) {
    return [
      {
        id: 'thinking',
        title: zh ? '思考中' : 'Thinking',
        detail: zh ? '正在理解你的消息。' : 'Understanding your message.',
        status: 'active',
      },
    ];
  }

  const pageDetail = intent.requestedPages
    ? (zh ? `已解析页数：${intent.requestedPages} 页，生成时必须 exactly ${intent.requestedPages} 个顶层页面。` : `Parsed page count: exactly ${intent.requestedPages} top-level pages.`)
    : (zh ? '未指定页数，由 Agent 根据需求决定页面结构。' : 'No page count specified; the Agent will choose the page structure.');
  const motionDetail = intent.wantsAnimation
    ? (zh ? '已识别动画需求：生成 HTML 时必须包含可预览、可逐帧导出的动效。' : 'Animation requested: generated HTML must preview and export deterministically.')
    : (zh ? '未指定动画时保持页面稳定，不额外制造复杂动效。' : 'No animation requested; keep motion restrained.');
  const toolDetail = intent.toolNames && intent.toolNames.length > 0
    ? `${zh ? '仅开放工具：' : 'Allowed tools only: '}${intent.toolNames.join(', ')}`
    : intent.toolNames && intent.toolNames.length === 0
    ? (zh ? '本轮明确不开放工具，只做澄清或直接回复。' : 'Tools are explicitly disabled for clarification or direct reply.')
    : intent.wantsVideoExport
    ? (zh ? '明确请求 MP4 时，后台渲染器逐帧截图，再调用 FFmpeg 合成。' : 'For explicit MP4 requests, the background renderer captures frames, then FFmpeg encodes.')
    : (zh ? '开放已注册工具给模型自动选择；不用工具时直接回复。' : 'Registered tools are available for the model to choose; answer directly when no tool is needed.');
  const skillDetail = intent.htmlSkill
    ? `${pageDetail} ${motionDetail} ${zh ? '内置质量 Skill：' : 'Built-in quality skill: '}${skillLabel(intent.htmlSkill, getLanguage())}`
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
      title: intent.wantsVideoExport ? (zh ? '准备后台渲染' : 'Prepare background render') : intent.toolNames && intent.toolNames.length > 0 ? (zh ? '执行工具轮' : 'Run tool turns') : intent.toolNames && intent.toolNames.length === 0 ? (zh ? '直接追问' : 'Ask directly') : (zh ? '模型自主编排' : 'Model orchestration'),
      detail: intent.wantsVideoExport
        ? (zh ? 'HTML 完成后仅排入 MP4 队列，工作区继续停在当前预览。' : 'After HTML is ready, MP4 is queued while the workspace stays on the current preview.')
        : intent.toolNames && intent.toolNames.length > 0
        ? (zh ? '按白名单顺序收集工具结果。' : 'Collect tool results from the whitelist.')
        : intent.toolNames && intent.toolNames.length === 0
        ? (zh ? '先问清楚，不执行工具。' : 'Clarify first without running tools.')
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

function isOrchestrationIntent(intent: AgentIntent): boolean {
  if (intent.needsClarification) return false;
  return Boolean(
    intent.wantsHtmlOutput
    || intent.wantsVideoExport
    || intent.htmlSkill
    || intent.id === 'image-to-html'
    || intent.id === 'export-plan'
    || intent.id === 'media-plan'
    || (intent.toolNames && intent.toolNames.length > 0),
  );
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

function buildWorkflowForIntent(intent: AgentIntent, plan?: AgentExecutionPlan): WorkflowStep[] | undefined {
  if (plan) {
    if (!isOrchestrationPlan(plan)) return undefined;

    const steps: WorkflowStep[] = [
      {
        id: 'planner',
        agent: 'AgentPlanner',
        action: plan.needs_clarification ? 'ask_clarification' : 'plan',
        parameters: {
          primaryIntent: plan.primary_intent,
          allowedTools: plan.allowed_tools.length > 0 ? plan.allowed_tools : 'disabled',
        },
        depends_on: [],
        status: 'Done',
        result: {
          focus: plan.task_focus,
          routeReason: plan.route_reason,
          steps: plan.steps,
          needsClarification: plan.needs_clarification,
          question: plan.clarification_question || undefined,
          wantsHtmlOutput: plan.wants_html_output,
          wantsPreviewUpdate: plan.wants_preview_update,
          wantsVideoExport: plan.wants_video_export,
        },
      },
    ];

    if (plan.allowed_tools.length > 0) {
      steps.push({
        id: 'tool-route',
        agent: 'ToolRouter',
        action: 'constrain_tools',
        parameters: { tools: plan.allowed_tools },
        depends_on: ['planner'],
        status: 'Done',
        result: { allowed: plan.allowed_tools },
      });
    }

    if (plan.wants_html_output || plan.wants_preview_update) {
      steps.push({
        id: 'preview',
        agent: 'PreviewUpdater',
        action: plan.wants_html_output ? 'save_and_preview_html' : 'prepare_reply',
        parameters: { source: 'agent_result' },
        depends_on: plan.allowed_tools.length > 0 ? ['tool-route'] : ['planner'],
        status: 'Done',
        result: { htmlOutput: plan.wants_html_output, previewUpdate: plan.wants_preview_update },
      });
    }

    if (plan.wants_video_export) {
      steps.push({
        id: 'render-mp4',
        agent: 'PreviewRenderer',
        action: 'render_mp4',
        parameters: { resolution: '1920x1080', fps: 30 },
        depends_on: steps.some((step) => step.id === 'preview') ? ['preview'] : ['planner'],
        status: 'Running',
        result: { encoder: 'FFmpeg', mode: 'page-by-page animated frames' },
      });
    }

    return steps;
  }

  if (!isOrchestrationIntent(intent)) return undefined;

  const steps: WorkflowStep[] = [
    {
      id: 'planner',
      agent: 'AgentPlanner',
      action: intent.needsClarification ? 'ask_clarification' : 'plan',
      parameters: {
        intent: intent.id,
        tools: intent.toolNames
          ? intent.toolNames.length > 0 ? intent.toolNames : 'disabled'
          : 'auto',
      },
      depends_on: [],
      status: 'Done',
      result: {
        focus: intent.summary,
        needsClarification: Boolean(intent.needsClarification),
        question: intent.clarificationQuestion || undefined,
      },
    },
  ];
  if (intent.requestedPages) {
    steps.push({
      id: 'infer-pages',
      agent: 'Planner',
      action: 'infer_pages',
      parameters: { text: 'user request' },
      depends_on: ['planner'],
      status: 'Done',
      result: { pages: intent.requestedPages },
    });
  }
  if (intent.wantsAnimation) {
    steps.push({
      id: 'motion-plan',
      agent: 'MotionHTMLSkill',
      action: 'plan_animation',
      parameters: { deterministicExport: true },
      depends_on: intent.requestedPages ? ['infer-pages'] : ['planner'],
      status: 'Done',
      result: { exportFrameEvent: 'seehtml:export-frame' },
    });
  }
  if (intent.wantsVideoExport) {
    steps.push({
      id: 'render-mp4',
      agent: 'PreviewRenderer',
      action: 'render_mp4',
      parameters: { resolution: '1920x1080', fps: 30 },
      depends_on: ['motion-plan'].filter((id) => steps.some((step) => step.id === id)).concat(steps.some((step) => step.id === 'motion-plan') ? [] : ['planner']),
      status: 'Running',
      result: { encoder: 'FFmpeg', mode: 'page-by-page animated frames' },
    });
  }
  return steps.length > 0 ? steps : undefined;
}

function isOrchestrationPlan(plan: AgentExecutionPlan): boolean {
  const normalizedIntent = plan.primary_intent.toLowerCase();
  return Boolean(
    plan.allowed_tools.length > 0
    || plan.wants_html_output
    || plan.wants_preview_update
    || plan.wants_video_export
    || ['create_html', 'edit_html', 'open_file', 'export', 'media', 'publish'].includes(normalizedIntent),
  );
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
    void get().sendMessage(next.content, next.imageDataUrls || next.imageDataUrl);
  }, 80);
}

function normalizeImageDataUrls(value?: string | string[]): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function requireProjectForIntent(intent: AgentIntent, hasImage: boolean): string {
  const projectPath = useUIStore.getState().projectPath;
  const needsProject = hasImage
    || intent.wantsHtmlOutput
    || intent.wantsVideoExport
    || intent.id === 'export-plan';
  if (needsProject && !projectPath) {
    throw new Error(t('project.required'));
  }
  return projectPath || '';
}

function requireProjectForCommand(cmd: string): string {
  const projectPath = useUIStore.getState().projectPath;
  const needsProject = ['ai', 'generate', 'theme', 'style', 'export', 'publish', 'package'].includes(cmd);
  if (needsProject && !projectPath) {
    throw new Error(t('project.required'));
  }
  return projectPath || '';
}

async function saveHtmlToProject(html: string, projectPath: string): Promise<string | null> {
  if (!projectPath) {
    usePreviewStore.getState().setGeneratedHtml(html, extractTitle(html) || 'AI HTML Preview');
    useUIStore.getState().setWorkspaceSelectionPath(null);
    useUIStore.getState().setWorkspaceMode('preview');
    return null;
  }

  const { invoke } = await import('@tauri-apps/api/core');
  const path = await invoke<string>('save_html', {
    html,
    path: projectHtmlPath(projectPath),
  });
  notifyProjectFilesChanged(projectPath);
  const doc = await usePreviewStore.getState().openFile(path, fileName(path));
  if (doc) {
    showDocumentInWorkspace(path, doc.kind);
  }
  return path;
}

function showDocumentInWorkspace(path: string, kind: string): void {
  const ui = useUIStore.getState();
  ui.setWorkspaceSelectionPath(path);
  ui.setWorkspaceMode(kind === 'video' ? 'mp4' : 'preview');
}

function withSavedPath(content: string, path: string | null): string {
  if (!path) return content;
  return `${content}\n${t('project.savedTo')}\n${path}`;
}

function buildPromptForIntent(
  content: string,
  html: string | null,
  intent: AgentIntent,
  projectPath: string,
): string {
  const base = html ? withCurrentDocument(content, html) : content;
  if (!intent.wantsHtmlOutput) return base;
  const qualityPrompt = intent.htmlSkill ? buildHtmlSkillPrompt(intent.htmlSkill, getLanguage()) : '';
  const pagePrompt = intent.requestedPages
    ? `The user requested exactly ${intent.requestedPages} pages. Return exactly ${intent.requestedPages} top-level page sections and no extra hidden, blank, duplicated, cover, appendix, or decorative sections that could be counted as pages.
Use this shape for each page:
<section class="slide" data-slide="1">...</section>
...
<section class="slide" data-slide="${intent.requestedPages}">...</section>`
    : 'If the user did not specify a page count, choose the smallest number of complete pages that satisfies the request.';
  const motionPrompt = intent.wantsAnimation
    ? `The user requested animation. Each page must have visible motion in normal preview and deterministic export support:
- Define a renderAtTime(seconds) function or equivalent deterministic update path.
- Listen for window event "seehtml:export-frame" and render from event.detail.time.
- Also support normal requestAnimationFrame preview.
- Avoid relying only on real elapsed wall-clock time, because MP4 export captures frames programmatically.`
    : 'Do not add heavy animation unless the user requested it.';
  const videoPrompt = intent.wantsVideoExport
    ? 'After this HTML is generated, the app will queue a background 1080p/30fps MP4 render only because the user explicitly requested MP4. Make the animation loop cleanly within each page duration.'
    : '';

  return `${base}

When the request is to create or edit a page, return ONLY one complete <!DOCTYPE html> document with inline CSS and JavaScript if needed.
The HTML must be directly previewable in an iframe. Use available tools only when they clearly help; otherwise answer directly.
Planner boundary:
- The selected HTML quality profile is guidance, not a hard boundary.
- If the user's requirements are still ambiguous, ask one concise clarification question instead of inventing missing details.
- Do not export or render MP4 unless the user explicitly asked for MP4/video export in this turn.
${pagePrompt}
${motionPrompt}
${videoPrompt}
The selected project folder is: ${projectPath}
The app will save the final HTML into this project after you return it.

${qualityPrompt}`;
}

async function buildImagePrompt(
  content: string,
  imageDataUrls: string[],
  intent: AgentIntent,
  projectPath: string,
): Promise<string> {
  const ocrItems: string[] = [];
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    for (let index = 0; index < imageDataUrls.length; index += 1) {
      try {
        const savedPath = await invoke<string>('save_image', {
          dataUrl: imageDataUrls[index],
          index: 900 + index,
          outputDir: projectExportDir(projectPath),
        });
        notifyProjectFilesChanged(projectPath);
        const ocrResult = await invoke<{ text?: string }>('run_ocr', { imagePath: savedPath, engine: 'easyocr' });
        const text = (ocrResult?.text || '').trim();
        ocrItems.push(`Image ${index + 1} OCR:\n"""\n${text || '(no readable text detected)'}\n"""`);
      } catch {
        ocrItems.push(`Image ${index + 1} OCR:\n"""\n(OCR unavailable for this image)\n"""`);
      }
    }
  } catch {}

  const userIntent = content.trim();
  const ocrText = ocrItems.join('\n\n');
  const hasSubstantialText = ocrText.length > 80 && !ocrText.includes('(no readable text detected)');
  const qualityPrompt = intent.htmlSkill ? `\n\n${buildHtmlSkillPrompt(intent.htmlSkill, getLanguage())}` : '';
  const imageCount = imageDataUrls.length;
  const pagePrompt = intent.requestedPages
    ? `Create exactly ${intent.requestedPages} pages using exactly ${intent.requestedPages} top-level <section class="slide" data-slide="..."> elements. Do not create extra hidden, blank, duplicate, cover, appendix, or decorative sections that could be counted as pages.`
    : 'Choose the smallest complete page count that satisfies the request.';
  const motionPrompt = intent.wantsAnimation
    ? `Each page must include visible animation and deterministic export support. Listen for "seehtml:export-frame" and render from event.detail.time; also support normal requestAnimationFrame preview.`
    : 'Do not add heavy animation unless the user requested it.';
  const videoPrompt = intent.wantsVideoExport
    ? 'After this HTML is generated, the app will queue a background 1080p/30fps MP4 render only because the user explicitly requested MP4, so animation must be frame-seekable and loop cleanly.'
    : '';
  const fallbackTask = imageCount > 1
    ? 'Analyze these reference images together and create a complete responsive HTML page that follows their layout, content hierarchy, visual style, and common intent.'
    : 'Analyze the image intent and create a visually polished landing page.';

  return `I am sending ${imageCount} reference image${imageCount > 1 ? 's' : ''}.

${ocrText || 'No OCR text was available.'}

${userIntent || (hasSubstantialText
    ? 'Generate a complete HTML page that faithfully reproduces the layout, colors, text hierarchy, and visual structure.'
    : fallbackTask)}

When multiple images are provided, treat them as one design/context set unless the user explicitly says otherwise.
${pagePrompt}
${motionPrompt}
${videoPrompt}
Selected project folder: ${projectPath}
The app will save the final HTML into this project after you return it.
Planner boundary:
- Image-derived skill selection is guidance, not a hard boundary.
- Ask one concise clarification question if the requested transformation is unclear.
- Do not export or render MP4 unless the user explicitly asked for MP4/video export in this turn.
Return a complete <!DOCTYPE html> document with inline CSS and JavaScript when useful.${qualityPrompt}`;
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

function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase()
    === b.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
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
