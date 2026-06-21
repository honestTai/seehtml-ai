import { create } from 'zustand';
import type { AgentToolEvent, ChatMessage, ClarificationOption, ProcessingArtifact, ProcessingStep, QueuedRequest, WorkflowStep } from '../types';
import { runAgentLoop, type AgentExecutionPlan, type AgentStreamEvent, type LlmMessage } from '../lib/agentLoop';
import { getLanguage, t, type Lang } from '../lib/i18n';
import {
  notifyProjectFilesChanged,
  projectExportDir,
  projectExportPath,
  projectHtmlPath,
} from '../lib/projectPaths';
import {
  MP4_EXPORT_PROFILES,
  getMp4ExportProfile,
  inferMp4ExportProfileId,
  mp4ProfileDescription,
  mp4ProfileLabel,
  mp4ProfileOptionLabel,
  toMp4ExportProfileId,
  type Mp4ExportProfileId,
} from '../lib/mp4ExportProfiles';
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
const LONG_TASK_NOTICE_MS = 120_000;
const MAX_SESSION_MESSAGES = 200;
const MAX_LOCAL_MEMORY_ITEMS = 80;
const MAX_MEMORY_PAYLOAD_ITEMS = 40;
const MAX_MEMORY_VALUE_CHARS = 2400;
const QUALITY_REPAIR_MODEL_ATTEMPTS = 1;

interface PersistentMemoryRecord {
  key: string;
  value: string;
  kind?: string;
  source?: string | null;
  updated_at?: string;
}

interface AiCapabilities {
  supportsVision: boolean;
  useDefaultOcr: boolean;
}

type ImageAssetMode = 'ask' | 'use-assets' | 'reference-only' | 'hybrid';

interface PreparedImageAsset {
  kind: string;
  label: string;
  path: string;
  relative_path: string;
  width: number;
  height: number;
}

interface HtmlQualityGateResult {
  html: string;
  qualityChecks: HtmlQualityCheck[];
  notes: string[];
}

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
  hydrateMemory: (projectPath?: string | null) => Promise<void>;
  loadHistory: () => void;
  saveHistory: () => void;
}

const WELCOME_MSG: Record<Lang, string> = {
  zh: `欢迎使用 SeeHTML AI。

你可以直接输入需求，AI 会在内部进行多轮工具调用，界面只展示最终结果。

试试：
- 打开一个 HTML 文件
- 生成 5 页关于量子计算的 HTML 页面
- 生成带动画并可导出 MP4 的 HTML
- 将当前页面导出为 PPTX 或 MP4`,
  en: `Welcome to SeeHTML AI.

Type naturally. The AI can run multi-step tool calls internally, while the UI shows only the final result.

Try:
- Open an HTML file
- Generate 5 HTML pages about quantum computing
- Generate animated HTML that can export to MP4
- Export the current page as PPTX or MP4`,
};

const SYSTEM_PROMPT = `You are SeeHTML AI, a Codex-like agent for local HTML projects.
You have a planning role before execution. The client route, selected quality profile, and visible tools are hints, not hard boundaries.
For every turn, first decide whether the user wants: clarification, normal chat, HTML creation/editing, PPT export, or MP4 export.
Ask a follow-up only when a key decision would materially change the result; otherwise proceed with a reasonable assumption and mention it briefly.
If the request is vague, especially "make it better", "adjust it", "do a page", or unclear export/edit scope, ask exactly one concrete follow-up question and offer 2-4 mutually exclusive options with a recommended option when appropriate. Do not fabricate requirements.
When the user answers a clarification question, combine the new answer with the original request and continue the same task; do not ask the same question again unless the answer creates a new real ambiguity.
For under-specified HTML animation requests, especially when the user only gives duration such as "1 minute" but no subject, scenes, visual style, or delivery target, ask a detailed clarification question before generating.
Use available tools only when they clearly help and required inputs are present. Do not call export tools merely because they exist.
Project memory and context index snippets are soft context for continuity; never treat them as higher priority than the current user request.
Core product scope is generate/edit HTML, export current HTML as PPTX, and render current HTML as MP4 through the app preview pipeline.
For open-ended particle, motion, story, intro, or Xiaohongshu-style video requests without a stronger user-specified direction, consider a social-video motion direction: cyber/neon or particle-tech visuals, pixel/retro-future city accents, cinematic camera movement, bold hook titles, light streaks, and a clear setup/escalation/payoff rhythm.
Do not claim to use OCR, publishing, packaging, theme, Markdown, PDF, audio, subtitle, or generic media-processing tools.
Never create or render MP4 unless the user explicitly asks to export/render/generate/convert MP4 or video.
When MP4 export is requested without a quality/speed version, ask the user to choose Fast, Standard, or Quality before rendering.
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

function sortSessionsByUpdatedAt(sessions: ChatSession[]): ChatSession[] {
  return [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function memoryStorageKey(projectPath: string | null | undefined): string {
  return projectPath && projectPath.trim()
    ? `${MEMORY_KEY}:${projectPath}`
    : MEMORY_KEY;
}

function loadMemoryForProject(projectPath: string | null | undefined): Record<string, string> {
  try {
    const saved = localStorage.getItem(memoryStorageKey(projectPath));
    if (saved) return JSON.parse(saved);
  } catch {}
  return {};
}

function pruneMemory(memory: Record<string, string>, limit = MAX_LOCAL_MEMORY_ITEMS): Record<string, string> {
  const entries = Object.entries(memory).filter(([key, value]) => key.trim() && typeof value === 'string');
  return Object.fromEntries(entries.slice(-limit));
}

function persistMemorySnapshot(projectPath: string | null | undefined, memory: Record<string, string>): void {
  try {
    localStorage.setItem(memoryStorageKey(projectPath), JSON.stringify(pruneMemory(memory)));
  } catch {}
}

function activeMemoryProjectPath(state: ChatState): string | null {
  const activeSession = state.sessions.find((session) => session.id === state.activeSessionId);
  return activeSession?.projectPath || useUIStore.getState().projectPath || null;
}

const initialSessionState = loadSavedSessionState();
const initialMemoryProjectPath = initialSessionState.sessions.find((session) => session.id === initialSessionState.activeSessionId)?.projectPath
  || useUIStore.getState().projectPath;

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
  conversationMemory: loadMemoryForProject(initialMemoryProjectPath),

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
    const previewDocForIntent = usePreviewStore.getState().document;
    const hasCurrentHtmlForIntent = Boolean(state.htmlDocument || (previewDocForIntent?.kind === 'html' && previewDocForIntent.content));
    const intent = classifyIntent(content, images.length > 0, hasCurrentHtmlForIntent);
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: displayContent,
      imageDataUrl: images[0],
      imageDataUrls: images,
      timestamp: new Date().toISOString(),
    };
    const requestId = crypto.randomUUID();
    const startedAt = userMsg.timestamp;
    set({
      messages: [...state.messages, userMsg],
      inputValue: '',
      isProcessing: true,
      activeRequestId: requestId,
      processingSteps: createProcessingSteps(intent),
    });
    get().saveHistory();
    beginProcessingTimeline(set, get, requestId, intent);

    if (intent.needsClarification && intent.clarificationQuestion) {
      const agentMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'agent',
        content: formatClarificationContent(intent),
        timestamp: new Date().toISOString(),
        startedAt,
        completedAt: new Date().toISOString(),
        processingTrace: finalizeProcessingTrace(get().processingSteps, 'done'),
        clarification: buildClarificationPrompt(intent, displayContent, images),
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

    try {
      const projectPath = requireProjectForIntent(intent, images.length > 0);
      const previewDoc = usePreviewStore.getState().document;
      const currentHtml = state.htmlDocument || (previewDoc?.kind === 'html' ? previewDoc.content || null : null);
      const currentFile = previewDoc?.path || null;

      if (intent.wantsVideoExport && !intent.wantsHtmlOutput) {
        if (!currentHtml) throw new Error(t('chat.noHtmlDocument'));
        const clarification = intent.mp4ProfileId ? undefined : buildMp4ExportClarification(displayContent);
        const responseContent = intent.mp4ProfileId
          ? queueMp4RenderFromProfile({
              profileId: intent.mp4ProfileId,
              requestedPages: intent.requestedPages,
              reason: content,
            })
          : formatMp4ProfileChoiceContent();
        const agentMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'agent',
          content: responseContent,
          timestamp: new Date().toISOString(),
          startedAt,
          completedAt: new Date().toISOString(),
          processingTrace: finalizeProcessingTrace(get().processingSteps, 'done'),
          clarification,
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
        if (completed) {
          rememberAgentTurn(get, displayContent, agentMsg.content, intent.id);
          drainQueuedRequest(set, get);
        }
        return;
      }

      const imageCapabilities = images.length > 0 ? await loadAiCapabilities() : null;
      const prompt = images.length > 0
        ? await buildImagePrompt(content, images, intent, projectPath, imageCapabilities || undefined, currentHtml, currentFile)
        : buildPromptForIntent(content, currentHtml, intent, projectPath);
      const memoryPayload = await buildMemoryPayload(state.conversationMemory, content, projectPath);

      const { assistantContent, messages, plan } = await runAgentLoop(
        prompt,
        state.messages.filter((m) => m.role !== 'system' || m.id === 'welcome'),
        {
          systemPrompt: SYSTEM_PROMPT,
          maxIterations: intent.maxIterations,
          toolNames: intent.toolNames,
          sessionId: state.activeSessionId,
          projectDir: projectPath || null,
          currentFile,
          currentHtml,
          memory: memoryPayload,
          imageDataUrls: imageCapabilities?.supportsVision ? images : [],
          onEvent: (event) => applyAgentStreamEvent(set, get, requestId, event),
        },
      );

      let html = extractHtmlFromAgentOutput(assistantContent, messages);
      const errors = collectToolErrors(messages);
      const toolEvents = collectToolEvents(messages);
      let htmlQuality = html ? validateHtmlQuality(html, getLanguage(), intent.htmlSkill) : [];
      const repairNotes: string[] = [];
      if (html) {
        const repaired = await runHtmlQualityGate({
          html,
          intent,
          projectPath,
          currentFile,
          requestId,
          set,
          get,
          memoryPayload,
        });
        html = repaired.html;
        htmlQuality = repaired.qualityChecks;
        repairNotes.push(...repaired.notes);
      }
      let savedHtmlPath: string | null = null;
      if (html) {
        savedHtmlPath = await saveHtmlToProject(html, projectPath);
        if (intent.wantsVideoExport) {
          if (intent.mp4ProfileId) {
            queueMp4RenderFromProfile({
              profileId: intent.mp4ProfileId,
              requestedPages: intent.requestedPages,
              reason: content,
            });
          }
        }
      }
      const mp4Clarification = html && intent.wantsVideoExport && !intent.mp4ProfileId
        ? buildMp4ExportClarification(displayContent)
        : undefined;
      const assistantText = withSavedPath(
        appendRepairNotes(
          formatAssistantContent(assistantContent, html, errors, intent.htmlSkill, htmlQuality),
          repairNotes,
        ),
        savedHtmlPath,
      );
      const traceArtifacts = html
        ? buildHtmlProcessingArtifacts({
            path: savedHtmlPath,
            previousHtml: currentHtml,
            nextHtml: html,
            qualityChecks: htmlQuality,
          })
        : [];
      const agentMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'agent',
        content: mp4Clarification ? `${assistantText}\n\n${formatMp4ProfileChoiceContent()}` : assistantText,
        timestamp: new Date().toISOString(),
        startedAt,
        completedAt: new Date().toISOString(),
        processingTrace: attachProcessingArtifacts(finalizeProcessingTrace(get().processingSteps, 'done'), traceArtifacts),
        qualityChecks: htmlQuality,
        toolEvents,
        clarification: plan?.needs_clarification
          ? {
              question: plan.clarification_question || assistantContent,
              options: parseClarificationOptions(plan.clarification_options),
              originalRequest: displayContent,
            }
          : mp4Clarification,
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
      if (completed) {
        rememberAgentTurn(get, displayContent, agentMsg.content, intent.id);
        drainQueuedRequest(set, get);
      }
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
    const commandParams = isRecord(params) ? params : {};
    const commandMp4ProfileId = parsed.cmd === 'export' && normalizeExportFormat(parsed.rest, commandParams) === 'video'
      ? normalizeMp4ExportProfileId(parsed.rest, commandParams)
      : null;
    const baseIntent = classifyIntent(command, false, Boolean(state.htmlDocument));
    const intent = {
      ...baseIntent,
      mp4ProfileId: commandMp4ProfileId ?? baseIntent.mp4ProfileId,
    };
    const commandHtmlSkill = parsed.cmd === 'ai' || parsed.cmd === 'generate'
      ? selectHtmlSkill(parsed.rest, 'create')
      : undefined;
    const displayCommand = typeof commandParams.display === 'string' && commandParams.display.trim()
      ? commandParams.display
      : commandParams.path ? `${command} ${String(commandParams.path)}` : command;
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: displayCommand,
      timestamp: new Date().toISOString(),
    };
    const requestId = crypto.randomUUID();
    const startedAt = userMsg.timestamp;
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
      let clarification: ChatMessage['clarification'];
      let qualityChecks: HtmlQualityCheck[] = [];
      const repairNotes: string[] = [];

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
        const result = await invoke('run_workflow', {
          command: 'ai',
          params: { topic, slides },
        });
        nextHtml = extractHtmlFromWorkflowResult(result);
        workflowSteps = extractWorkflowSteps(result);
        responseContent = nextHtml
          ? `${t('chat.generated')}\n${extractTitle(nextHtml) || topic}`
          : formatWorkflowResult(result);
      } else if (parsed.cmd === 'theme' || parsed.cmd === 'style') {
        responseContent = t('command.coreOnly');
      } else if (parsed.cmd === 'export') {
        if (!state.htmlDocument) throw new Error(t('chat.noHtmlDocument'));
        const format = normalizeExportFormat(parsed.rest, commandParams);
        if (format === 'video') {
          const profileId = normalizeMp4ExportProfileId(parsed.rest, commandParams);
          if (profileId) {
            responseContent = queueMp4RenderFromProfile({
              profileId,
              reason: command,
            });
          } else {
            responseContent = formatMp4ProfileChoiceContent();
            clarification = buildMp4ExportClarification(displayCommand);
          }
          workflowSteps = buildWorkflowForIntent({
            ...intent,
            wantsVideoExport: true,
            mp4ProfileId: profileId,
          });
        } else if (format === 'pptx') {
          const outputPath = projectExportPath(projectPath, 'document.pptx');
          startBackgroundDocumentExport({
            html: state.htmlDocument,
            format,
            outputPath,
            projectPath,
          });
          responseContent = backgroundExportMessage(format, outputPath);
        } else {
          responseContent = t('command.coreOnly');
        }
      } else if (parsed.cmd === 'publish' || parsed.cmd === 'package') {
        responseContent = t('command.coreOnly');
      } else {
        responseContent = t('command.coreOnly');
      }

      if (nextHtml) {
        if (commandHtmlSkill) {
          const repaired = await runHtmlQualityGate({
            html: nextHtml,
            intent: { ...intent, htmlSkill: commandHtmlSkill, wantsHtmlOutput: true },
            projectPath,
            currentFile: null,
            requestId,
            set,
            get,
            memoryPayload: {},
          });
          nextHtml = repaired.html;
          qualityChecks = repaired.qualityChecks;
          repairNotes.push(...repaired.notes);
          responseContent = `${responseContent}\n${summarizeHtmlQuality(
            qualityChecks,
            commandHtmlSkill,
            getLanguage(),
          )}`;
        }
        savedHtmlPath = await saveHtmlToProject(nextHtml, projectPath);
      }

      const traceArtifacts = nextHtml
        ? buildHtmlProcessingArtifacts({
            path: savedHtmlPath,
            previousHtml: state.htmlDocument,
            nextHtml,
            qualityChecks,
          })
        : [];
      const agentMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'agent',
        content: withSavedPath(appendRepairNotes(responseContent, repairNotes), savedHtmlPath),
        timestamp: new Date().toISOString(),
        startedAt,
        completedAt: new Date().toISOString(),
        processingTrace: attachProcessingArtifacts(finalizeProcessingTrace(get().processingSteps, 'done'), traceArtifacts),
        qualityChecks,
        clarification,
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
      if (completed) {
        rememberAgentTurn(get, displayCommand, agentMsg.content, parsed.cmd);
        drainQueuedRequest(set, get);
      }
    } catch (e: unknown) {
      appendError(set, get, e, requestId);
    }
  },

  stopProcessing: () => {
    const state = get();
    if (!state.isProcessing) return;
    const now = new Date().toISOString();
    const stopMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'system',
      content: t('chat.cancelled'),
      timestamp: now,
      completedAt: now,
      processingTrace: finalizeProcessingTrace(state.processingSteps, 'error', now),
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
    const sessions = sortSessionsByUpdatedAt([next, ...synced]);
    set({
      sessions,
      activeSessionId: next.id,
      messages: next.messages,
      conversationMemory: loadMemoryForProject(next.projectPath),
      inputValue: '',
      queuedRequests: [],
      processingSteps: [],
      activeRequestId: null,
    });
    persistSessions(sessions, next.id);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next.messages)); } catch {}
    void get().hydrateMemory(next.projectPath);
  },

  switchSession: (id) => {
    if (get().isProcessing) return;
    const synced = syncActiveSessionSnapshot(get());
    const target = synced.find((session) => session.id === id);
    if (!target) return;
    const sessions = sortSessionsByUpdatedAt(synced);
    set({
      sessions,
      activeSessionId: id,
      messages: target.messages,
      conversationMemory: loadMemoryForProject(target.projectPath),
      inputValue: '',
      queuedRequests: [],
      processingSteps: [],
      activeRequestId: null,
    });
    persistSessions(sessions, id);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(target.messages)); } catch {}
    void get().hydrateMemory(target.projectPath);
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
    const sorted = sortSessionsByUpdatedAt(sessions);
    set({
      sessions: sorted,
      activeSessionId: target.id,
      messages: target.messages,
      conversationMemory: loadMemoryForProject(projectPath),
      inputValue: '',
    });
    persistSessions(sorted, target.id);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(target.messages)); } catch {}
    void get().hydrateMemory(projectPath);
  },

  setHtmlDocument: (html) => set({ htmlDocument: html }),

  saveMemory: (key, value) => {
    const projectPath = activeMemoryProjectPath(get());
    const memory = pruneMemory({ ...get().conversationMemory, [key]: value });
    set({ conversationMemory: memory });
    persistMemorySnapshot(projectPath, memory);
    if (projectPath) {
      void import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke('set_memory', { projectPath, key, value }))
        .catch(() => undefined);
    }
  },

  getMemory: (key) => get().conversationMemory[key],

  hydrateMemory: async (projectPath) => {
    const targetProject = projectPath ?? activeMemoryProjectPath(get());
    if (!targetProject) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      void invoke('refresh_context_index', { projectPath: targetProject, limit: 120 }).catch(() => undefined);
      const records = await invoke<PersistentMemoryRecord[]>('list_memory', {
        projectPath: targetProject,
        limit: MAX_LOCAL_MEMORY_ITEMS,
      });
      const merged = pruneMemory({
        ...loadMemoryForProject(targetProject),
        ...Object.fromEntries(records.map((record) => [record.key, record.value])),
      });
      const currentProject = activeMemoryProjectPath(get());
      persistMemorySnapshot(targetProject, merged);
      if (samePath(currentProject, targetProject)) {
        set({ conversationMemory: merged });
      }
    } catch {}
  },

  loadHistory: () => set({ messages: loadSavedMessages() }),

  saveHistory: () => {
    try {
      const state = get();
      const msgs = state.messages.slice(-MAX_SESSION_MESSAGES);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs));
      const sessions = sortSessionsByUpdatedAt(syncActiveSessionSnapshot(state));
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
  mp4ProfileId?: Mp4ExportProfileId | null;
  htmlSkill?: HtmlSkill;
  imageAssetMode?: ImageAssetMode;
  needsClarification?: boolean;
  clarificationQuestion?: string;
  clarificationOptions?: ClarificationOption[];
}

function classifyIntent(content: string, hasImage: boolean, hasHtml: boolean): AgentIntent {
  const text = content.trim();
  const lower = text.toLowerCase();
  const zh = getLanguage() === 'zh';
  const requestedPages = inferPageCountFromText(text);
  const wantsAnimation = /(动画|动效|运动|自动渲染|逐页渲染|粒子|转场|animate|animated|animation|motion|transition)/i.test(text);
  const wantsVideoExport = isExplicitMp4ExportRequest(text);
  const mp4ProfileId = wantsVideoExport ? inferMp4ExportProfileId(text) : null;
  const createWords = /(生成|创建|做一个|做个|写一个|写个|设计|制作|页面|网页|html|动效|粒子|炫酷|landing|create|generate|make|build|design)/i;
  const htmlCreationWords = /(页面|网页|html|动效|动画|粒子|炫酷|landing|page|site|web|html|animate|animation|motion|design)/i;
  const editWords = /(修改|优化|改成|换成|调整|美化|润色|重做|重新弄|重新做|主题|风格|按图|参考|照着|不像|像这|像图|像截图|还原|继续|接着|再|更|不要|加上|去掉|修复|edit|update|change|theme|style|polish|redo|rework|revise|iterate)/i;
  const exportWords = /(导出|输出|转成|转为|转换|export|convert|ppt|pptx|powerpoint|mp4|video)/i;

  if (hasImage) {
    const imageEdit = hasHtml && (editWords.test(text) || isRevisionRequest(text) || isImageReferenceEditRequest(text));
    const htmlSkill = selectHtmlSkill(text, imageEdit ? 'edit' : 'image');
    const imageAssetMode = inferImageAssetMode(text);
    if (imageAssetMode === 'ask' && shouldAskImageAssetMode(text)) {
      return clarificationIntent(
        zh ? '图片素材用法不够明确' : 'Image asset usage is unclear',
        zh
          ? '需要先确认这张图是要作为真实素材裁切使用，还是只当风格参考，避免模型重新画偏。'
          : 'Confirm whether the image should be used as real assets or only as a style reference.',
        zh ? '这次上传的图片想怎么参与 HTML 生成？' : 'How should the uploaded image be used for this HTML?',
        imageAssetModeOptions(zh),
      );
    }
    return {
      id: imageEdit ? 'image-edit-html' : 'image-to-html',
      title: zh ? (imageEdit ? '按图修改 HTML' : '图片理解') : (imageEdit ? 'Edit HTML from image' : 'Image understanding'),
      summary: zh
        ? imageEdit
          ? `按“${imageAssetModeLabel(imageAssetMode, 'zh')}”处理上传图片，继续修改当前 HTML 文件；${requestedPages ? `保持 exactly ${requestedPages} 页；` : ''}完成后覆盖保存并刷新预览。`
          : `先按“${imageAssetModeLabel(imageAssetMode, 'zh')}”处理图片${requestedPages ? `，按 ${requestedPages} 页` : ''}，再套用 ${skillLabel(htmlSkill, 'zh')} 输出高质量 HTML。`
        : imageEdit
          ? `Use the uploaded image with "${imageAssetModeLabel(imageAssetMode, 'en')}" to revise the current HTML file${requestedPages ? ` as exactly ${requestedPages} pages` : ''}, then save and refresh preview.`
          : `Process the image with "${imageAssetModeLabel(imageAssetMode, 'en')}"${requestedPages ? `, create ${requestedPages} pages` : ''}, then use ${skillLabel(htmlSkill, 'en')} for high-quality HTML.`,
      maxIterations: 6,
      wantsHtmlOutput: true,
      requestedPages,
      wantsAnimation,
      wantsVideoExport,
      mp4ProfileId,
      htmlSkill,
      imageAssetMode,
    };
  }

  const asksCreate = createWords.test(text) && !(wantsVideoExport && hasHtml && !htmlCreationWords.test(text));
  const asksEdit = hasHtml && (editWords.test(text) || isRevisionRequest(text));
  const asksExportOnly = exportWords.test(text) && !asksCreate && !asksEdit;

  if (asksCreate || asksEdit) {
    if (asksCreate && isUnderSpecifiedAnimationRequest(text)) {
      return clarificationIntent(
        zh ? '动画信息不够明确' : 'Animation brief is incomplete',
        zh
          ? '需要先确认动画主题、视觉路线和交付方式，避免直接生成一个跑偏的 1 分钟页面。'
          : 'Confirm the animation subject, visual route, and delivery target before generating a long timeline.',
        animationClarificationQuestion(text, zh),
        animationClarificationOptions(zh),
      );
    }
    if (asksCreate && isVagueCreateRequest(text)) {
      return clarificationIntent(
        zh ? '页面目标不够明确' : 'Page goal is unclear',
        zh ? '要先确认页面主题和风格，再生成 HTML。' : 'Confirm the page topic and style before generating HTML.',
        zh ? '你想做什么主题的 HTML？' : 'What should this HTML be about?',
        createClarificationOptions(zh),
      );
    }
    if (asksEdit && isVagueEditRequest(text)) {
      return clarificationIntent(
        zh ? '修改范围不够明确' : 'Edit scope is unclear',
        zh ? '需要先确认具体改哪里，避免把现有页面改偏。' : 'Confirm the edit scope before changing the current page.',
        zh ? '你想重点改哪一块？' : 'What should I focus on changing?',
        editClarificationOptions(zh),
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
      mp4ProfileId,
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
      mp4ProfileId,
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
    mp4ProfileId,
  };
}

function isExplicitMp4ExportRequest(text: string): boolean {
  const actionBeforeFormat = /(?:导出|输出|生成|制作|渲染|合成|转成|转为|转换|做一个|做个|encode|export|render|generate|create|make|convert).{0,18}(?:mp4|视频|video)/i;
  const formatBeforeAction = /(?:mp4|视频|video).{0,18}(?:导出|输出|生成|制作|渲染|合成|转成|转为|转换|encode|export|render|generate|create|make|convert)/i;
  return actionBeforeFormat.test(text) || formatBeforeAction.test(text);
}

function isUnderSpecifiedAnimationRequest(text: string): boolean {
  const normalized = text
    .replace(/[，。,.!！?？]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const asksAnimation = /(动画|动效|运动|转场|animate|animated|animation|motion|transition)/i.test(normalized);
  const asksHtml = /(html|网页|页面|web|page)/i.test(normalized);
  if (!asksAnimation || !asksHtml) return false;

  const hasCreativeDetail = /关于|主题|产品|品牌|公司|活动|课程|报告|登录|注册|仪表盘|个人|官网|营销|开场|片头|故事|角色|人物|场景|宇宙|星空|海洋|城市|山水|国风|水墨|赛博|科技|霓虹|像素|电影|数据|图表|粒子|烟花|音乐|倒计时|logo|SaaS|CRM|电商|教育|医疗|金融|旅游|游戏|portfolio|landing|dashboard|login|signup|product|brand|story|character|scene|cyber|neon|particle|data|chart|logo/i.test(normalized);
  const hasDuration = /(\d+(?:\.\d+)?\s*(秒|分钟|分|s|sec|second|seconds|min|minute|minutes)|一\s*分钟|半\s*分钟|60\s*s)/i.test(normalized);
  return !hasCreativeDetail || (hasDuration && !hasCreativeDetail);
}

function isRevisionRequest(text: string): boolean {
  const normalized = text
    .replace(/[，。,.!！?？]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;
  return /(继续|接着|上一版|当前|这个页面|这个文件|这版|再|更|不要|不对|不是|不像|差不多|按.*图|参考.*图|照.*图|对齐|保留|替换|加上|加入|添加|去掉|删除|修复|修一下|改一下|重新改|迭代|revision|revise|iterate|continue|current|previous|again|more|less|match|reference|fix)/i.test(normalized);
}

function isImageReferenceEditRequest(text: string): boolean {
  const normalized = text
    .replace(/[，。,.!！?？]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /(按|照|参考|根据|对齐|还原|不像|像这|像图|像截图|match|reference|use.*image|according.*image|from.*image)/i.test(normalized);
}

function inferImageAssetMode(text: string): ImageAssetMode {
  const normalized = text
    .replace(/[，。,.!！?？]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/(仅参考|只参考|参考风格|风格参考|不用原图|不要用原图|不要用素材|不使用素材|重新画|重绘|纯\s*html|纯\s*css|reference only|style only|redraw|do not use image assets)/i.test(normalized)) {
    return 'reference-only';
  }
  if (/(混合|一部分用|部分使用|背景用|底图用|素材.*重绘|原图.*重绘|hybrid|mix image assets)/i.test(normalized)) {
    return 'hybrid';
  }
  if (/(使用素材|用素材|用原图|使用原图|用这张图|直接用图|直接使用|作为素材|作为背景|抠图|扣图|裁切|剪裁|切图|分镜|贴图|截取|抽取|crop|cutout|asset|use original|use image asset|use this image)/i.test(normalized)) {
    return 'use-assets';
  }
  return 'ask';
}

function shouldAskImageAssetMode(text: string): boolean {
  const normalized = text
    .replace(/[，。,.!！?？]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return true;
  const readOnlyImageQuestion = /(这是什么|图片里有什么|识别|读图|ocr|提取文字|describe|what is in|read text)/i.test(normalized);
  const creationOrEdit = /(按|照|参考|根据|还原|设计|素材|生成|创建|做|制作|修改|优化|重做|html|页面|网页|动画|动效|视频|短片|海报|截图|ui|image|design|reference|create|generate|make|build|edit|animate|video)/i.test(normalized);
  return creationOrEdit || !readOnlyImageQuestion;
}

function imageAssetModeOptions(zh: boolean): ClarificationOption[] {
  return zh
    ? [
        option('使用素材并自动裁切', '推荐：本地工具先生成整图、局部裁切和透明候选，HTML 直接引用真实素材，最贴近原图。', true),
        option('混合：素材+重绘', '用原图/局部做背景或关键物体，同时让 Agent 重绘文字、动效、结构和缺失元素。'),
        option('仅参考风格重绘', '不直接使用原图素材，只把图片当构图、配色和风格参考；适合不想把素材打进 HTML。'),
      ]
    : [
        option('Use assets and auto-crop', 'Recommended: create full-image, region, and transparent candidates locally, then reference real assets in HTML.', true),
        option('Hybrid: assets plus redraw', 'Use the image or regions as key backgrounds/objects while redrawing text, motion, layout, and missing elements.'),
        option('Reference-only redraw', 'Do not embed the image. Use it only for composition, color, and style cues.'),
      ];
}

function imageAssetModeLabel(mode: ImageAssetMode | undefined, lang: Lang): string {
  const zh = lang === 'zh';
  switch (mode) {
    case 'use-assets':
      return zh ? '使用素材并自动裁切' : 'use assets and auto-crop';
    case 'hybrid':
      return zh ? '混合：素材+重绘' : 'hybrid assets plus redraw';
    case 'reference-only':
      return zh ? '仅参考风格重绘' : 'reference-only redraw';
    default:
      return zh ? '先确认素材用法' : 'ask how to use image assets';
  }
}

function animationClarificationQuestion(text: string, zh: boolean): string {
  const hasDuration = /(\d+(?:\.\d+)?\s*(秒|分钟|分|s|sec|second|seconds|min|minute|minutes)|一\s*分钟|半\s*分钟|60\s*s)/i.test(text);
  if (zh) {
    return hasDuration
      ? '这个时长较长的 HTML 动画，先选哪条创作路线？'
      : '这个 HTML 动画想做哪种内容方向？';
  }
  return hasDuration
    ? 'Which creative route should this longer HTML animation follow?'
    : 'What kind of HTML animation should this be?';
}

function animationClarificationOptions(zh: boolean): ClarificationOption[] {
  return zh
    ? [
        option('赛博粒子短视频', '推荐：霓虹像素城市、镜头推进、爆点字幕、粒子流光，适合小红书风格开场。', true),
        option('粒子剧情动画', '适合做三幕故事：开场世界观、粒子爆发/转场、品牌或标题收束。'),
        option('产品/品牌介绍动画', '适合有品牌名、卖点和开场收尾；需要你补一个产品或品牌主题。'),
        option('循环背景/屏保动效', '适合做可长时间播放的氛围背景，内容少但导出更稳。'),
      ]
    : [
        option('Cyber particle short', 'Recommended: neon pixel city, camera push, hook typography, particles, and social-video pacing.', true),
        option('Particle story animation', 'Best for a three-beat story: world setup, particle transformation, and title/end-card payoff.'),
        option('Product / brand intro', 'Best when you have a brand name, value props, and an opening/ending beat.'),
        option('Looping ambient background', 'Best for a long-running background with fewer content beats and steadier export.'),
      ];
}

function createClarificationOptions(zh: boolean): ClarificationOption[] {
  return zh
    ? [
        option('营销/产品页', '用于介绍产品、服务或活动；我会补齐首屏、卖点、证明和行动按钮。', true),
        option('演示/PPT 页', '用于多页讲解或汇报；我会按页面结构组织标题、图表区和结论。'),
        option('赛博粒子动画页', '用于强视觉动效；默认做霓虹、像素城市、镜头感字幕，并支持逐帧导出。'),
        option('打开现有 HTML 再改', '先选择本地 HTML 文件，再基于真实页面继续优化。', false, {
          command: '/open',
          params: { display: zh ? '打开现有 HTML 再改' : 'Open an existing HTML first' },
        }),
      ]
    : [
        option('Landing/product page', 'Use this for a product, service, or campaign with hero, proof, and CTA.', true),
        option('Slide/deck page', 'Use this for multi-page explanation or reporting with titles, visual areas, and takeaways.'),
        option('Cyber particle animation', 'Use this for strong motion with neon, pixel-city cues, kinetic titles, and frame-seekable export.'),
        option('Open existing HTML first', 'Pick a local HTML file first, then continue from the real page.', false, {
          command: '/open',
          params: { display: 'Open an existing HTML first' },
        }),
      ];
}

function editClarificationOptions(zh: boolean): ClarificationOption[] {
  return zh
    ? [
        option('整体 UI 质感', '保留结构，重点提升留白、层级、按钮和视觉完成度。', true),
        option('布局结构', '调整页面分区、栅格、响应式和信息顺序，改动会更明显。'),
        option('颜色/字体', '只改视觉主题、字号、字体和配色，风险较低。'),
        option('动画/交互', '增强过渡、hover、滚动或动效，需要保证不影响导出稳定性。'),
      ]
    : [
        option('Overall UI polish', 'Keep the structure and improve spacing, hierarchy, buttons, and visual finish.', true),
        option('Layout structure', 'Change sections, grid, responsiveness, and information order; this is more visible.'),
        option('Color/typography', 'Only adjust theme, type scale, fonts, and palette; lower risk.'),
        option('Motion/interaction', 'Improve transitions, hover, scroll, or animation while keeping export stable.'),
      ];
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
  options: ClarificationOption[],
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

function formatClarificationContent(intent: AgentIntent): string {
  const question = intent.clarificationQuestion || (getLanguage() === 'zh' ? '你想怎么继续？' : 'How should I continue?');
  const detailHint = getLanguage() === 'zh'
    ? '点一个选项我就继续；也可以自定义补充更具体的主题、风格、节奏或导出要求。'
    : 'Choose one option and I will continue; or add a custom subject, style, pacing, or export requirement.';
  return `${question}\n\n${detailHint}`;
}

function buildClarificationPrompt(
  intent: AgentIntent,
  originalRequest: string,
  imageDataUrls: string[] = [],
): ChatMessage['clarification'] {
  if (!intent.clarificationQuestion || !intent.clarificationOptions?.length) return undefined;
  return {
    question: intent.clarificationQuestion,
    options: intent.clarificationOptions,
    originalRequest,
    imageDataUrls: imageDataUrls.length > 0 ? imageDataUrls : undefined,
  };
}

function option(
  label: string,
  description: string,
  recommended = false,
  extra: Partial<ClarificationOption> = {},
): ClarificationOption {
  return { label, description, recommended, ...extra };
}

function parseClarificationOption(value: string): ClarificationOption {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const recommended = /\((recommended|推荐)\)|（(recommended|推荐)）/i.test(normalized);
  const withoutBadge = normalized
    .replace(/\s*[\(（](recommended|推荐)[\)）]\s*/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const separator = withoutBadge.match(/\s(?:—|--|-|：|:)\s/);
  if (!separator || separator.index === undefined) {
    return { label: withoutBadge || normalized, recommended };
  }

  const label = withoutBadge.slice(0, separator.index).trim();
  const description = withoutBadge.slice(separator.index + separator[0].length).trim();
  return {
    label: label || withoutBadge,
    description: description || undefined,
    recommended,
  };
}

function parseClarificationOptions(options: string[] | undefined): ClarificationOption[] {
  return (options || [])
    .map(parseClarificationOption)
    .filter((item) => item.label)
    .slice(0, 5);
}

function buildMp4ExportClarification(originalRequest: string): ChatMessage['clarification'] {
  const lang = getLanguage();
  const zh = lang === 'zh';
  return {
    question: zh ? '选择一个 MP4 导出版本' : 'Choose an MP4 export version',
    originalRequest,
    options: MP4_EXPORT_PROFILES.map((profile) => ({
      label: mp4ProfileOptionLabel(profile, lang),
      description: mp4ProfileDescription(profile, lang),
      recommended: profile.id === 'standard',
      command: '/export mp4',
      params: {
        format: 'mp4',
        profileId: profile.id,
        display: zh
          ? `选择${mp4ProfileOptionLabel(profile, lang)}导出 MP4`
          : `Export MP4 as ${mp4ProfileOptionLabel(profile, lang)}`,
      },
    })),
  };
}

function formatMp4ProfileChoiceContent(): string {
  return getLanguage() === 'zh'
    ? '可以导出 MP4。先选择导出版本：快速版更快，标准版推荐，高清版最流畅但耗时最长。'
    : 'MP4 export is available. Choose a version first: Fast is quicker, Standard is recommended, and Quality is smoothest but slowest.';
}

function queueMp4RenderFromProfile({
  profileId,
  requestedPages,
  reason,
}: {
  profileId: Mp4ExportProfileId;
  requestedPages?: number;
  reason: string;
}): string {
  const profile = getMp4ExportProfile(profileId);
  usePreviewStore.getState().requestRender({
    type: 'mp4',
    pageCount: requestedPages,
    reason,
    profileId: profile.id,
    frameRate: profile.fps,
  });
  return `${t('export.mp4BackgroundRunning')} · ${mp4ProfileOptionLabel(profile, getLanguage())}`;
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
  const now = new Date().toISOString();
  if (!isOrchestrationIntent(intent)) {
    return [
      {
        id: 'thinking',
        title: zh ? '思考中' : 'Thinking',
        detail: zh ? '正在理解你的消息。' : 'Understanding your message.',
        status: 'active',
        startedAt: now,
      },
    ];
  }

  const pageDetail = intent.requestedPages
    ? (zh ? `已解析页数：${intent.requestedPages} 页，生成时必须 exactly ${intent.requestedPages} 个顶层页面。` : `Parsed page count: exactly ${intent.requestedPages} top-level pages.`)
    : (zh ? '未指定页数，由 Agent 根据需求决定页面结构。' : 'No page count specified; the Agent will choose the page structure.');
  const motionDetail = intent.wantsAnimation
    ? (zh ? '已识别动画需求：生成 HTML 时必须包含可预览、可逐帧导出的动效。' : 'Animation requested: generated HTML must preview and export deterministically.')
    : (zh ? '未指定动画时保持页面稳定，不额外制造复杂动效。' : 'No animation requested; keep motion restrained.');
  const imageDetail = intent.imageAssetMode && intent.imageAssetMode !== 'reference-only'
    ? (zh
        ? `图片策略：${imageAssetModeLabel(intent.imageAssetMode, 'zh')}；生成前会准备本地整图、裁切和透明候选素材。`
        : `Image strategy: ${imageAssetModeLabel(intent.imageAssetMode, 'en')}; local full-image, crop, and transparent candidates are prepared before generation.`)
    : intent.imageAssetMode === 'reference-only'
    ? (zh ? '图片策略：仅参考风格重绘，不直接嵌入上传素材。' : 'Image strategy: reference-only redraw; uploaded assets are not embedded.')
    : '';
  const toolDetail = intent.toolNames && intent.toolNames.length > 0
    ? `${zh ? '仅开放工具：' : 'Allowed tools only: '}${intent.toolNames.join(', ')}`
    : intent.toolNames && intent.toolNames.length === 0
    ? (zh ? '本轮明确不开放工具，只做澄清或直接回复。' : 'Tools are explicitly disabled for clarification or direct reply.')
    : intent.wantsVideoExport
    ? intent.mp4ProfileId
      ? `${zh ? '明确请求 MP4：' : 'Explicit MP4 request: '}${mp4ProfileOptionLabel(getMp4ExportProfile(intent.mp4ProfileId), getLanguage())}`
      : (zh ? '明确请求 MP4，但需要先选择导出版本。' : 'Explicit MP4 request; an export version must be selected first.')
    : (zh ? '只开放核心工具给模型选择；不用工具时直接回复。' : 'Only core tools are available for the model; answer directly when no tool is needed.');
  const skillDetail = intent.htmlSkill
    ? `${pageDetail} ${motionDetail} ${imageDetail ? `${imageDetail} ` : ''}${zh ? '内置质量 Skill：' : 'Built-in quality skill: '}${skillLabel(intent.htmlSkill, getLanguage())}`
    : toolDetail;
  return [
    {
      id: 'understand',
      title: zh ? 'LLM 理解问题' : 'LLM understands',
      detail: intent.summary,
      status: 'active',
      startedAt: now,
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
        ? intent.mp4ProfileId
          ? (zh ? '按所选版本排入 MP4 队列，导出完成后切到 MP4 预览。' : 'Queue MP4 with the selected version and open the MP4 preview when done.')
          : (zh ? '先提示用户选择快速/标准/高清版本，再触发后台渲染。' : 'Ask the user to choose Fast, Standard, or Quality before rendering.')
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
    || (intent.toolNames && intent.toolNames.length > 0),
  );
}

function beginProcessingTimeline(
  set: SetChatState,
  get: () => ChatState,
  requestId: string,
  intent: AgentIntent,
) {
  const stepCount = get().processingSteps.length || createProcessingSteps(intent).length;
  const delays = [320, 850, 1450, 2200];
  for (let index = 1; index < stepCount; index += 1) {
    window.setTimeout(() => {
      if (get().activeRequestId !== requestId) return;
      const now = new Date().toISOString();
      set((s) => ({
        processingSteps: s.processingSteps.map((step, i) => ({
          ...step,
          status: i < index ? 'done' : i === index ? 'active' : 'pending',
          startedAt: i === index ? step.startedAt || now : step.startedAt,
          completedAt: i < index ? step.completedAt || now : step.completedAt,
        })),
      }));
    }, delays[index - 1] ?? 1200);
  }

  window.setTimeout(() => {
    if (get().activeRequestId !== requestId) return;
    set((s) => ({
      processingSteps: s.processingSteps.map((step) => {
        if (step.status !== 'active') return step;
        const longTaskNote = getLanguage() === 'zh'
          ? '耗时较长，已进入长任务等待模式；不会因为前端计时器到点就自动中断。你可以继续等待、追加需求，或手动停止。'
          : 'This is taking longer than usual. The run stays alive instead of being stopped by a frontend timer; you can keep waiting, append context, or stop it manually.';
        if (step.detail.includes(longTaskNote)) return step;
        return {
          ...step,
          detail: `${step.detail}\n${longTaskNote}`,
        };
      }),
    }));
  }, LONG_TASK_NOTICE_MS);
}

function finalizeProcessingTrace(
  steps: ProcessingStep[],
  status: Extract<ProcessingStep['status'], 'done' | 'error'>,
  completedAt = new Date().toISOString(),
): ProcessingStep[] {
  if (steps.length === 0) return [];
  const activeIndex = steps.findIndex((step) => step.status === 'active');
  const firstPendingIndex = steps.findIndex((step) => step.status === 'pending');
  const firstErrorIndex = steps.findIndex((step) => step.status === 'error');
  const terminalIndex = status === 'error' && firstErrorIndex >= 0
    ? firstErrorIndex
    : activeIndex >= 0 ? activeIndex : firstPendingIndex >= 0 ? firstPendingIndex : steps.length - 1;

  return steps.map((step, index) => {
    if (status === 'error') {
      if (step.status === 'error') {
        return {
          ...step,
          startedAt: step.startedAt || completedAt,
          completedAt: step.completedAt || completedAt,
        };
      }
      if (index < terminalIndex || step.status === 'done') {
        return {
          ...step,
          status: 'done',
          startedAt: step.startedAt || completedAt,
          completedAt: step.completedAt || completedAt,
        };
      }
      if (index === terminalIndex) {
        return {
          ...step,
          status: 'error',
          startedAt: step.startedAt || completedAt,
          completedAt,
        };
      }
      return step;
    }

    if (step.status === 'error') return step;
    return {
      ...step,
      status: 'done',
      startedAt: step.startedAt || completedAt,
      completedAt: step.completedAt || completedAt,
    };
  });
}

function applyAgentStreamEvent(
  set: SetChatState,
  get: () => ChatState,
  requestId: string,
  event: AgentStreamEvent,
): void {
  const now = new Date().toISOString();
  set((s) => {
    if (s.activeRequestId !== requestId) return {};
    const steps = s.processingSteps.length > 0
      ? s.processingSteps
      : createProcessingSteps(classifyIntent('', false, Boolean(s.htmlDocument)));

    if (event.type === 'plan') {
      return {
        processingSteps: steps.map((step) => {
          if (step.id === 'understand') {
            return {
              ...step,
              status: 'done',
              completedAt: step.completedAt || now,
            };
          }
          if (step.id === 'route') {
            return {
              ...step,
              status: 'done',
              startedAt: step.startedAt || now,
              completedAt: now,
              detail: planTimelineDetail(event.plan),
            };
          }
          if (step.id === 'execute') {
            return {
              ...step,
              status: 'active',
              startedAt: step.startedAt || now,
              detail: executionTimelineDetail(event.plan),
            };
          }
          return step;
        }),
      };
    }

    if (event.type === 'thinking') {
      return {
        processingSteps: updateActiveStepDetail(steps, event.content, now),
      };
    }

    if (event.type === 'tool_call') {
      const toolStep: ProcessingStep = {
        id: `tool-${event.tool.id || event.tool.name}`,
        title: getLanguage() === 'zh' ? `工具调用：${event.tool.name}` : `Tool call: ${event.tool.name}`,
        detail: formatStreamValue(event.tool.arguments, 520),
        status: 'active',
        startedAt: now,
      };
      return {
        processingSteps: upsertProcessingStep(markActiveStepDone(steps, now), toolStep),
      };
    }

    if (event.type === 'tool_result') {
      const stepId = `tool-${event.result.tool_call_id || event.result.name}`;
      const failed = Boolean(extractError(event.result.result));
      return {
        processingSteps: steps.map((step) => {
          if (step.id !== stepId) return step;
          return {
            ...step,
            status: failed ? 'error' : 'done',
            completedAt: now,
            detail: formatToolTimelineResult(event.result.result),
          };
        }),
      };
    }

    if (event.type === 'text') {
      return {
        processingSteps: steps.map((step) => {
          if (step.status === 'active') {
            return { ...step, status: 'done', completedAt: step.completedAt || now };
          }
          if (step.id === 'preview') {
            return {
              ...step,
              status: 'active',
              startedAt: step.startedAt || now,
              detail: getLanguage() === 'zh'
                ? '模型已返回结果，正在解析 HTML、工具记录和质量检查。'
                : 'The model returned output; parsing HTML, tool records, and quality checks.',
            };
          }
          return step;
        }),
      };
    }

    if (event.type === 'done') {
      return {
        processingSteps: finalizeProcessingTrace(steps, 'done', now),
      };
    }

    if (event.type === 'error') {
      return {
        processingSteps: markActiveStepError(steps, event.message, now),
      };
    }

    return {};
  });
}

function planTimelineDetail(plan: AgentExecutionPlan): string {
  const zh = getLanguage() === 'zh';
  const lines = [
    plan.task_focus,
    plan.route_reason,
    plan.steps.length > 0
      ? `${zh ? '编排步骤：' : 'Planned steps: '}${plan.steps.join(zh ? ' → ' : ' -> ')}`
      : '',
  ].filter(Boolean);
  return lines.join('\n');
}

function executionTimelineDetail(plan: AgentExecutionPlan): string {
  const zh = getLanguage() === 'zh';
  if (plan.needs_clarification) {
    return plan.clarification_question || (zh ? '需要先追问一个关键问题。' : 'A key follow-up is needed first.');
  }
  if (plan.allowed_tools.length > 0) {
    return `${zh ? '按计划开放工具：' : 'Allowed tools: '}${plan.allowed_tools.join(', ')}`;
  }
  if (plan.wants_html_output || plan.wants_preview_update) {
    return zh
      ? '本轮由模型直接生成/修改 HTML，不强制调用工具。'
      : 'The model will generate or edit HTML directly; tools are not forced.';
  }
  return zh ? '本轮直接回复，不调用工具。' : 'Answer directly without tool calls.';
}

function updateActiveStepDetail(
  steps: ProcessingStep[],
  detail: string,
  now: string,
): ProcessingStep[] {
  const activeIndex = steps.findIndex((step) => step.status === 'active');
  if (activeIndex < 0) return steps;
  return steps.map((step, index) => {
    if (index !== activeIndex) return step;
    return {
      ...step,
      detail: mergeDetail(step.detail, detail),
      startedAt: step.startedAt || now,
    };
  });
}

function markActiveStepDone(steps: ProcessingStep[], now: string): ProcessingStep[] {
  return steps.map((step) => (
    step.status === 'active'
      ? { ...step, status: 'done', completedAt: step.completedAt || now }
      : step
  ));
}

function markActiveStepError(
  steps: ProcessingStep[],
  message: string,
  now: string,
): ProcessingStep[] {
  const activeIndex = steps.findIndex((step) => step.status === 'active');
  const modelStepIndex = isAiProviderError(message)
    ? steps.findIndex((step) => step.id === 'execute')
    : -1;
  const targetIndex = modelStepIndex >= 0
    ? modelStepIndex
    : activeIndex >= 0 ? activeIndex : Math.max(0, steps.length - 1);
  const friendlyMessage = friendlyAgentErrorMessage(message);
  return steps.map((step, index) => {
    if (index < targetIndex && step.status !== 'error') {
      return {
        ...step,
        status: 'done',
        completedAt: step.completedAt || now,
      };
    }
    if (index > targetIndex && step.status === 'active') {
      return {
        ...step,
        status: 'pending',
        completedAt: undefined,
      };
    }
    if (index !== targetIndex) return step;
    return {
      ...step,
      status: 'error',
      completedAt: now,
      detail: mergeDetail(step.detail, friendlyMessage),
    };
  });
}

function upsertProcessingStep(steps: ProcessingStep[], next: ProcessingStep): ProcessingStep[] {
  const index = steps.findIndex((step) => step.id === next.id);
  if (index < 0) return [...steps, next];
  return steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...next } : step);
}

function mergeDetail(current: string, addition: string): string {
  const clean = addition.trim();
  if (!clean || current.includes(clean)) return current;
  return `${current}\n${clean}`;
}

function friendlyAgentErrorMessage(message: string): string {
  const clean = message.replace(/^Error:\s*/i, '').trim();
  const zh = getLanguage() === 'zh';
  if (isAiProviderError(clean)) {
    return zh
      ? `模型服务连接失败，已按重连策略尝试 5 次。当前预览和上下文会保留，可以继续追加修改或稍后重试。\n原始错误：${clean}`
      : `The model provider connection failed after 5 retry attempts. The current preview and context are kept, so you can append edits or retry later.\nOriginal error: ${clean}`;
  }
  return clean;
}

function isAiProviderError(message: string): boolean {
  return /AI API error|LLM request failed|LLM API returned|error sending request|connection|timed out|timeout|429|502|503|504|chat\/completions/i.test(message);
}

function attachProcessingArtifacts(
  steps: ProcessingStep[],
  artifacts: ProcessingArtifact[],
): ProcessingStep[] {
  if (artifacts.length === 0) return steps;
  const preferred = steps.some((step) => step.id === 'preview') ? 'preview' : steps[steps.length - 1]?.id;
  return steps.map((step) => (
    step.id === preferred
      ? { ...step, artifacts: [...(step.artifacts || []), ...artifacts] }
      : step
  ));
}

function buildHtmlProcessingArtifacts({
  path,
  previousHtml,
  nextHtml,
  qualityChecks,
}: {
  path: string | null;
  previousHtml: string | null;
  nextHtml: string;
  qualityChecks: HtmlQualityCheck[];
}): ProcessingArtifact[] {
  const diff = htmlLineDiffStats(previousHtml, nextHtml);
  const passed = qualityChecks.filter((check) => check.passed).length;
  const quality = qualityChecks.length > 0
    ? `${getLanguage() === 'zh' ? '质量检查' : 'Quality checks'} ${passed}/${qualityChecks.length}`
    : getLanguage() === 'zh' ? '未运行额外质量检查' : 'No extra quality checks';
  return [
    {
      id: 'html-output',
      label: path ? fileName(path) : (getLanguage() === 'zh' ? '内存预览 HTML' : 'In-memory HTML preview'),
      path: path || undefined,
      stats: diff,
      detail: quality,
    },
  ];
}

function htmlLineDiffStats(previousHtml: string | null, nextHtml: string): string {
  const nextLines = splitLines(nextHtml);
  if (!previousHtml) {
    return getLanguage() === 'zh'
      ? `新建 ${nextLines.length} 行`
      : `Created ${nextLines.length} lines`;
  }

  const previousLines = splitLines(previousHtml);
  let prefix = 0;
  while (
    prefix < previousLines.length
    && prefix < nextLines.length
    && previousLines[prefix] === nextLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < previousLines.length - prefix
    && suffix < nextLines.length - prefix
    && previousLines[previousLines.length - 1 - suffix] === nextLines[nextLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const removed = Math.max(0, previousLines.length - prefix - suffix);
  const added = Math.max(0, nextLines.length - prefix - suffix);
  const startLine = prefix + 1;
  const endLine = Math.max(startLine, prefix + Math.max(added, removed));
  const zh = getLanguage() === 'zh';
  if (added === 0 && removed === 0) {
    return zh ? `共 ${nextLines.length} 行，内容无明显变化` : `${nextLines.length} lines, no visible line changes`;
  }
  return zh
    ? `共 ${nextLines.length} 行；修改约第 ${startLine}-${endLine} 行；+${added} -${removed}`
    : `${nextLines.length} lines; changed around lines ${startLine}-${endLine}; +${added} -${removed}`;
}

function splitLines(value: string): string[] {
  return value.replace(/\r\n/g, '\n').split('\n');
}

function formatStreamValue(value: unknown, maxLength: number): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n...` : text;
}

function formatToolTimelineResult(value: unknown): string {
  const error = extractError(value);
  if (error) return `${getLanguage() === 'zh' ? '工具失败：' : 'Tool failed: '}${error}`;
  const path = extractPath(value);
  if (path) return `${getLanguage() === 'zh' ? '输出文件：' : 'Output: '}${path}`;
  if (extractHtmlFromValue(value)) {
    return getLanguage() === 'zh' ? '工具返回 HTML，继续交给模型整合。' : 'Tool returned HTML for model integration.';
  }
  return formatStreamValue(value, 520);
}

function buildWorkflowForIntent(intent: AgentIntent, plan?: AgentExecutionPlan): WorkflowStep[] | undefined {
  if (intent.needsClarification) {
    return [
      {
        id: 'planner',
        agent: 'AgentPlanner',
        action: 'ask_clarification',
        parameters: {
          intent: intent.id,
          question: intent.clarificationQuestion,
        },
        depends_on: [],
        status: 'Done',
        result: {
          focus: intent.summary,
          options: (intent.clarificationOptions || []).map((item) => item.label),
        },
      },
    ];
  }

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

    if (intent.imageAssetMode) {
      steps.push({
        id: 'image-assets',
        agent: 'ImageAssetTool',
        action: intent.imageAssetMode === 'reference-only' ? 'reference_only' : 'prepare_local_assets',
        parameters: { mode: intent.imageAssetMode },
        depends_on: plan.allowed_tools.length > 0 ? ['tool-route'] : ['planner'],
        status: 'Done',
        result: {
          mode: imageAssetModeLabel(intent.imageAssetMode, getLanguage()),
          prepared: intent.imageAssetMode !== 'reference-only',
        },
      });
    }

    if (plan.wants_html_output || plan.wants_preview_update) {
      steps.push({
        id: 'preview',
        agent: 'PreviewUpdater',
        action: plan.wants_html_output ? 'save_and_preview_html' : 'prepare_reply',
        parameters: { source: 'agent_result' },
        depends_on: intent.imageAssetMode ? ['image-assets'] : plan.allowed_tools.length > 0 ? ['tool-route'] : ['planner'],
        status: 'Done',
        result: { htmlOutput: plan.wants_html_output, previewUpdate: plan.wants_preview_update },
      });
    }

    if (plan.wants_video_export) {
      const profile = intent.mp4ProfileId ? getMp4ExportProfile(intent.mp4ProfileId) : null;
      steps.push({
        id: 'render-mp4',
        agent: 'PreviewRenderer',
        action: profile ? 'render_mp4' : 'select_mp4_profile',
        parameters: {
          resolution: '1920x1080',
          profile: profile ? mp4ProfileLabel(profile, getLanguage()) : 'pending_user_choice',
          fps: profile?.fps ?? 'pending_user_choice',
        },
        depends_on: steps.some((step) => step.id === 'preview') ? ['preview'] : ['planner'],
        status: profile ? 'Running' : 'Waiting',
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
  if (intent.imageAssetMode) {
    steps.push({
      id: 'image-assets',
      agent: 'ImageAssetTool',
      action: intent.imageAssetMode === 'reference-only' ? 'reference_only' : 'prepare_local_assets',
      parameters: { mode: intent.imageAssetMode },
      depends_on: intent.requestedPages ? ['infer-pages'] : ['planner'],
      status: 'Done',
      result: {
        mode: imageAssetModeLabel(intent.imageAssetMode, getLanguage()),
        prepared: intent.imageAssetMode !== 'reference-only',
      },
    });
  }
  if (intent.wantsAnimation) {
    steps.push({
      id: 'motion-plan',
      agent: 'MotionHTMLSkill',
      action: 'plan_animation',
      parameters: { deterministicExport: true },
      depends_on: intent.imageAssetMode ? ['image-assets'] : intent.requestedPages ? ['infer-pages'] : ['planner'],
      status: 'Done',
      result: { exportFrameEvent: 'seehtml:export-frame' },
    });
  }
  if (intent.wantsVideoExport) {
    const profile = intent.mp4ProfileId ? getMp4ExportProfile(intent.mp4ProfileId) : null;
    steps.push({
      id: 'render-mp4',
      agent: 'PreviewRenderer',
      action: profile ? 'render_mp4' : 'select_mp4_profile',
      parameters: {
        resolution: '1920x1080',
        profile: profile ? mp4ProfileLabel(profile, getLanguage()) : 'pending_user_choice',
        fps: profile?.fps ?? 'pending_user_choice',
      },
      depends_on: ['motion-plan'].filter((id) => steps.some((step) => step.id === id)).concat(steps.some((step) => step.id === 'motion-plan') ? [] : ['planner']),
      status: profile ? 'Running' : 'Waiting',
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
    || ['create_html', 'edit_html', 'export_ppt', 'export_mp4', 'export'].includes(normalizedIntent),
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

async function buildMemoryPayload(
  localMemory: Record<string, string>,
  query: string,
  projectPath: string,
): Promise<Record<string, string>> {
  const merged = new Map<string, string>();
  for (const [key, value] of Object.entries(localMemory).slice(-MAX_MEMORY_PAYLOAD_ITEMS)) {
    merged.set(key, clipMemoryValue(value));
  }

  if (projectPath) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const records = await invoke<PersistentMemoryRecord[]>('search_memory', {
        projectPath,
        query: query.trim(),
        limit: MAX_MEMORY_PAYLOAD_ITEMS,
      });
      for (const record of records) {
        const prefix = record.kind === 'context' ? 'context' : 'memory';
        merged.set(`${prefix}:${record.key}`, clipMemoryValue(record.value));
      }
    } catch {}
  }

  return Object.fromEntries([...merged.entries()].slice(-MAX_MEMORY_PAYLOAD_ITEMS));
}

function rememberAgentTurn(
  get: () => ChatState,
  userContent: string,
  assistantContent: string,
  intent: string,
): void {
  const user = clipMemoryValue(userContent, 1000);
  const assistant = clipMemoryValue(assistantContent, 1400);
  if (!user && !assistant) return;
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : String(Date.now());
  get().saveMemory(
    `turn:${new Date().toISOString()}:${id}`,
    `intent=${intent}\nuser=${user}\nagent=${assistant}`,
  );
}

function clipMemoryValue(value: string, maxChars = MAX_MEMORY_VALUE_CHARS): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}...`;
}

async function loadAiCapabilities(): Promise<AiCapabilities> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const response = await invoke<{ config?: { supports_vision?: boolean; use_default_ocr?: boolean } }>('get_ai_config');
    return {
      supportsVision: Boolean(response.config?.supports_vision),
      useDefaultOcr: response.config?.use_default_ocr !== false,
    };
  } catch {
    return { supportsVision: false, useDefaultOcr: true };
  }
}

async function refreshProjectContextIndex(projectPath: string): Promise<void> {
  if (!projectPath) return;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('refresh_context_index', { projectPath, limit: 120 });
  } catch {}
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
  const needsProject = ['ai', 'generate', 'export'].includes(cmd);
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
  void refreshProjectContextIndex(projectPath);
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

function appendRepairNotes(content: string, notes: string[]): string {
  if (notes.length === 0) return content;
  const zh = getLanguage() === 'zh';
  return `${content}\n${zh ? '自动修复：' : 'Auto repair:'}\n${notes.map((note) => `- ${note}`).join('\n')}`;
}

async function runHtmlQualityGate({
  html,
  intent,
  projectPath,
  currentFile,
  requestId,
  set,
  get,
  memoryPayload,
}: {
  html: string;
  intent: AgentIntent;
  projectPath: string;
  currentFile: string | null;
  requestId: string;
  set: SetChatState;
  get: () => ChatState;
  memoryPayload: Record<string, string>;
}): Promise<HtmlQualityGateResult> {
  const zh = getLanguage() === 'zh';
  const notes: string[] = [];
  let nextHtml = html;

  const local = repairHtmlLocally(nextHtml, intent);
  nextHtml = local.html;
  notes.push(...local.notes);

  let qualityChecks = validateHtmlQualityForIntent(nextHtml, intent);
  if (local.notes.length > 0) {
    updateQualityGateStep(set, get, requestId, {
      status: allQualityPassed(qualityChecks) ? 'done' : 'active',
      detail: `${zh ? '已执行本地质量修复：' : 'Applied local quality repairs: '}${local.notes.join(zh ? '、' : ', ')}`,
    });
  }

  if (allQualityPassed(qualityChecks)) {
    return { html: nextHtml, qualityChecks, notes };
  }

  const failedBefore = qualityChecks.filter((check) => !check.passed);
  updateQualityGateStep(set, get, requestId, {
    status: 'active',
    detail: `${zh ? '质量检查未通过，准备自动修复：' : 'Quality checks failed; preparing auto repair: '}${failedBefore.map((item) => item.label).join(zh ? '、' : ', ')}`,
  });

  for (let attempt = 1; attempt <= QUALITY_REPAIR_MODEL_ATTEMPTS; attempt += 1) {
    try {
      const repairPrompt = buildQualityRepairPrompt(nextHtml, failedBefore, intent, projectPath);
      const repaired = await runAgentLoop(repairPrompt, [], {
        systemPrompt: SYSTEM_PROMPT,
        maxIterations: 2,
        toolNames: [],
        sessionId: get().activeSessionId,
        projectDir: projectPath || null,
        currentFile,
        currentHtml: nextHtml,
        memory: memoryPayload,
      });
      const repairedHtml = extractHtmlFromAgentOutput(repaired.assistantContent, repaired.messages);
      if (!repairedHtml) {
        notes.push(zh ? '模型自修复未返回可用 HTML，已保留本地修复版本。' : 'Model repair did not return usable HTML; kept the locally repaired version.');
        continue;
      }
      const repairedLocal = repairHtmlLocally(repairedHtml, intent);
      const candidate = repairedLocal.html;
      const candidateChecks = validateHtmlQualityForIntent(candidate, intent);
      const previousPassed = qualityChecks.filter((check) => check.passed).length;
      const nextPassed = candidateChecks.filter((check) => check.passed).length;
      if (nextPassed >= previousPassed) {
        nextHtml = candidate;
        qualityChecks = candidateChecks;
        notes.push(zh ? `模型自修复完成：质量检查 ${nextPassed}/${candidateChecks.length}。` : `Model repair completed: quality checks ${nextPassed}/${candidateChecks.length}.`);
        notes.push(...repairedLocal.notes);
      }
      if (allQualityPassed(qualityChecks)) break;
    } catch (error) {
      notes.push(zh
        ? `模型自修复失败，已保留当前可预览版本：${formatErrorMessage(error)}`
        : `Model repair failed; kept the current previewable version: ${formatErrorMessage(error)}`);
    }
  }

  updateQualityGateStep(set, get, requestId, {
    status: allQualityPassed(qualityChecks) ? 'done' : 'error',
    detail: allQualityPassed(qualityChecks)
      ? (zh ? '质量问题已自动修复并重新检查通过。' : 'Quality issues were repaired and checks now pass.')
      : `${zh ? '仍有待补强项，但已保留可预览版本：' : 'Some checks still need work, but the previewable version is kept: '}${qualityChecks.filter((check) => !check.passed).map((item) => item.label).join(zh ? '、' : ', ')}`,
  });

  return { html: nextHtml, qualityChecks, notes };
}

function validateHtmlQualityForIntent(html: string, intent: AgentIntent): HtmlQualityCheck[] {
  const checks = validateHtmlQuality(html, getLanguage(), intent.htmlSkill);
  if (intent.imageAssetMode === 'use-assets' || intent.imageAssetMode === 'hybrid') {
    checks.push({
      id: 'image-assets-used',
      label: getLanguage() === 'zh' ? '已引用上传图片裁切素材' : 'Uploaded image assets referenced',
      passed: /exports\/image-assets\/image_\d+\//i.test(html.replace(/\\/g, '/')),
    });
  }
  return checks;
}

function allQualityPassed(checks: HtmlQualityCheck[]): boolean {
  return checks.length === 0 || checks.every((check) => check.passed);
}

function repairHtmlLocally(html: string, intent: AgentIntent): { html: string; notes: string[] } {
  const zh = getLanguage() === 'zh';
  const notes: string[] = [];
  let next = toCompleteHtml(html);

  if (!/<!doctype html/i.test(next)) {
    next = `<!DOCTYPE html>\n${next}`;
    notes.push(zh ? '补全 DOCTYPE' : 'added DOCTYPE');
  }
  if (!/<meta[^>]+name=["']viewport["']/i.test(next)) {
    next = insertIntoHead(next, '<meta name="viewport" content="width=device-width, initial-scale=1.0" />');
    notes.push(zh ? '补全 viewport' : 'added viewport');
  }
  if (!/<title[^>]*>[\s\S]+?<\/title>/i.test(next)) {
    next = insertIntoHead(next, '<title>SeeHTML Motion</title>');
    notes.push(zh ? '补全标题' : 'added title');
  }
  if (!/<style[\s>]/i.test(next)) {
    next = insertIntoHead(next, `<style>
html, body { margin: 0; min-height: 100%; }
body { overflow-x: hidden; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
*, *::before, *::after { box-sizing: border-box; }
img, canvas, video, svg { max-width: 100%; height: auto; }
@media (max-width: 720px) { body { font-size: 14px; } }
</style>`);
    notes.push(zh ? '补全基础样式' : 'added base styles');
  } else if (!/(@media|clamp\(|min\(|max\(|aspect-ratio|vh|vw|rem)/i.test(next)) {
    next = next.replace(/<\/style>/i, `
@media (max-width: 720px) { body { font-size: 14px; } }
img, canvas, video, svg { max-width: 100%; height: auto; }
</style>`);
    notes.push(zh ? '补充响应式约束' : 'added responsive constraints');
  }

  const needsExportHook = intent.wantsAnimation || intent.wantsVideoExport || intent.htmlSkill?.id === 'canvas-video' || intent.htmlSkill?.id === 'motion-html';
  if (needsExportHook && !/renderAtTime|seehtml:export-frame|__SEEHTML_EXPORT_TIME__/i.test(next)) {
    next = insertBeforeBodyEnd(next, `<script>
(function () {
  const DURATION = Number(window.__SEEHTML_EXPORT_DURATION__ || 30);
  window.__SEEHTML_EXPORT_DURATION__ = DURATION;
  if (typeof window.renderAtTime !== 'function') {
    window.renderAtTime = function renderAtTime(seconds) {
      window.__SEEHTML_EXPORT_TIME__ = seconds;
    };
  }
  window.addEventListener('seehtml:export-frame', function (event) {
    const time = event && event.detail && typeof event.detail.time === 'number'
      ? event.detail.time
      : Number(window.__SEEHTML_EXPORT_TIME__ || 0);
    window.renderAtTime(time);
  });
})();
</script>`);
    notes.push(zh ? '补充 MP4 逐帧导出 hook' : 'added MP4 frame export hook');
  }

  return { html: next, notes };
}

function insertIntoHead(html: string, snippet: string): string {
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${snippet}\n</head>`);
  if (/<html[\s>]/i.test(html)) return html.replace(/<html([^>]*)>/i, `<html$1>\n<head>\n${snippet}\n</head>`);
  return `${snippet}\n${html}`;
}

function insertBeforeBodyEnd(html: string, snippet: string): string {
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${snippet}\n</body>`);
  return `${html}\n${snippet}`;
}

function buildQualityRepairPrompt(
  html: string,
  failedChecks: HtmlQualityCheck[],
  intent: AgentIntent,
  projectPath: string,
): string {
  const failed = failedChecks.map((check) => `- ${check.label}`).join('\n');
  const assetRule = intent.imageAssetMode === 'use-assets' || intent.imageAssetMode === 'hybrid'
    ? `\nImage asset hard rule:\n- The user uploaded image material and chose/asked for cropping or asset use.\n- You MUST use prepared project assets via relative paths under exports/image-assets/image_1/ (for example full_reference.png, center_16x9.png, panel_1.png, cutout_bright_subject.png if useful).\n- The returned HTML is invalid if it does not reference at least one exports/image-assets/... path.\n- Do not redraw unrelated content from imagination; build motion, layout, captions, and camera movement around the uploaded/cropped image material.`
    : '';
  return `Repair this HTML so all quality checks pass. Return ONLY one complete <!DOCTYPE html> document. Do not explain, do not use Markdown.

Failed checks:
${failed || '- none'}
${assetRule}

Project folder: ${projectPath}

Keep the user's original creative direction, current visuals, animation timing, and useful behavior. Make the smallest complete repair that fixes the checks.

Current HTML:
\`\`\`html
${html.length > 18000 ? `${html.slice(0, 18000)}\n<!-- truncated -->` : html}
\`\`\``;
}

function updateQualityGateStep(
  set: SetChatState,
  get: () => ChatState,
  requestId: string,
  patch: { status: ProcessingStep['status']; detail: string },
): void {
  const now = new Date().toISOString();
  set((state) => {
    if (state.activeRequestId !== requestId) return {};
    const title = getLanguage() === 'zh' ? '质量检查与自动修复' : 'Quality check and auto repair';
    const nextStep: ProcessingStep = {
      id: 'quality-repair',
      title,
      detail: patch.detail,
      status: patch.status,
      startedAt: now,
      completedAt: patch.status === 'active' ? undefined : now,
    };
    return {
      processingSteps: upsertProcessingStep(markActiveStepDone(state.processingSteps, now), nextStep),
    };
  });
}

function imageAssetStrategyPrompt(mode: ImageAssetMode, imageCount: number): string {
  const plural = imageCount > 1 ? 'images' : 'image';
  if (mode === 'use-assets') {
    return `Use the uploaded ${plural} as real source material. Local preparation creates reusable crops/cutouts; embed suitable prepared assets directly in the HTML.`;
  }
  if (mode === 'hybrid') {
    return `Hybrid use: preserve the uploaded ${plural} through prepared assets where fidelity matters, and redraw/animate text, effects, layout, or missing pieces.`;
  }
  return `Reference-only: do not embed the uploaded ${plural}; use visual understanding/OCR only to recreate the style or layout.`;
}

function formatPreparedAssetPrompt(imageIndex: number, assets: PreparedImageAsset[]): string {
  const lines = assets
    .slice(0, 14)
    .map((asset) => {
      const relative = asset.relative_path || asset.path.replace(/\\/g, '/');
      return `- ${asset.kind}: ${asset.label}; src="${relative}"; ${asset.width}x${asset.height}`;
    });
  return `Image ${imageIndex} prepared assets:\n${lines.join('\n')}`;
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || 'unknown error');
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
- Define renderAtTime(seconds) and render the full frame from absolute time, not accumulated deltas.
- Assign window.renderAtTime = renderAtTime.
- Listen for window event "seehtml:export-frame" and render from event.detail.time.
- Also read window.__SEEHTML_EXPORT_TIME__ when present.
- Also support normal requestAnimationFrame preview.
- Avoid relying only on real elapsed wall-clock time, random drift, network assets, or async state, because MP4 export captures frames programmatically.`
    : 'Do not add heavy animation unless the user requested it.';
  const videoPrompt = intent.wantsVideoExport
    ? intent.mp4ProfileId
      ? `After this HTML is generated, the app will queue a background 1080p/${getMp4ExportProfile(intent.mp4ProfileId).fps}fps MP4 render only because the user explicitly requested MP4. Make the animation loop cleanly within each page duration.`
      : 'After this HTML is generated, the app will ask the user to choose a Fast, Standard, or Quality MP4 export version before rendering. Make the animation loop cleanly within each page duration.'
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
  capabilities: AiCapabilities = { supportsVision: false, useDefaultOcr: true },
  currentHtml: string | null = null,
  currentFile: string | null = null,
): Promise<string> {
  const ocrItems: string[] = [];
  const assetItems: string[] = [];
  const imageAssetMode = intent.imageAssetMode && intent.imageAssetMode !== 'ask'
    ? intent.imageAssetMode
    : inferImageAssetMode(content);
  const effectiveAssetMode: ImageAssetMode = imageAssetMode === 'ask' ? 'reference-only' : imageAssetMode;
  const shouldPrepareAssets = effectiveAssetMode === 'use-assets' || effectiveAssetMode === 'hybrid';
  const shouldRunDefaultOcr = !capabilities.supportsVision && capabilities.useDefaultOcr !== false;
  const ocrMode = shouldRunDefaultOcr
    ? 'Configured model is not marked as vision-capable, so default local OCR fallback is used.'
    : capabilities.supportsVision
    ? 'Configured model is multimodal; image pixels are attached directly as OpenAI-compatible image_url content. OCR fallback is skipped.'
    : 'Configured model is not vision-capable and OCR fallback is disabled; images are saved as local references only.';
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
        if (shouldPrepareAssets) {
          try {
            const preparedAssets = await invoke<PreparedImageAsset[]>('prepare_image_assets', {
              imagePath: savedPath,
              projectDir: projectPath,
              index: index + 1,
            });
            if (preparedAssets.length > 0) {
              assetItems.push(formatPreparedAssetPrompt(index + 1, preparedAssets));
              notifyProjectFilesChanged(projectPath);
            }
          } catch (error) {
            assetItems.push(`Image ${index + 1} asset preparation failed: ${formatErrorMessage(error)}.`);
          }
        }
        if (shouldRunDefaultOcr) {
          const ocrResult = await invoke<{ text?: string }>('run_ocr', { imagePath: savedPath, engine: 'easyocr' });
          const text = (ocrResult?.text || '').trim();
          ocrItems.push(`Image ${index + 1} saved at: ${savedPath}\nOCR:\n"""\n${text || '(no readable text detected)'}\n"""`);
        } else {
          ocrItems.push(`Image ${index + 1} saved at: ${savedPath}\nOCR skipped by model capability settings.`);
        }
      } catch {
        ocrItems.push(`Image ${index + 1} OCR:\n"""\n(OCR unavailable for this image)\n"""`);
      }
    }
  } catch {}

  const userIntent = content.trim();
  const ocrText = ocrItems.join('\n\n');
  const preparedAssetText = assetItems.join('\n\n');
  const hasSubstantialText = shouldRunDefaultOcr
    && ocrText.length > 80
    && !ocrText.includes('(no readable text detected)')
    && !ocrText.includes('OCR skipped');
  const qualityPrompt = intent.htmlSkill ? `\n\n${buildHtmlSkillPrompt(intent.htmlSkill, getLanguage())}` : '';
  const imageCount = imageDataUrls.length;
  const editingCurrentHtml = Boolean(currentHtml && intent.id === 'image-edit-html');
  const pagePrompt = intent.requestedPages
    ? `Create exactly ${intent.requestedPages} pages using exactly ${intent.requestedPages} top-level <section class="slide" data-slide="..."> elements. Do not create extra hidden, blank, duplicate, cover, appendix, or decorative sections that could be counted as pages.`
    : 'Choose the smallest complete page count that satisfies the request.';
  const motionPrompt = intent.wantsAnimation
    ? `Each page must include visible animation and deterministic export support. Define renderAtTime(seconds), assign window.renderAtTime, listen for "seehtml:export-frame", render from event.detail.time or window.__SEEHTML_EXPORT_TIME__, and keep normal requestAnimationFrame preview.`
    : 'Do not add heavy animation unless the user requested it.';
  const videoPrompt = intent.wantsVideoExport
    ? intent.mp4ProfileId
      ? `After this HTML is generated, the app will queue a background 1080p/${getMp4ExportProfile(intent.mp4ProfileId).fps}fps MP4 render only because the user explicitly requested MP4, so animation must be frame-seekable and loop cleanly.`
      : 'After this HTML is generated, the app will ask the user to choose a Fast, Standard, or Quality MP4 export version before rendering, so animation must be frame-seekable and loop cleanly.'
    : '';
  const fallbackTask = imageCount > 1
    ? 'Analyze these reference images together and create a complete responsive HTML page that follows their layout, content hierarchy, visual style, and common intent.'
    : 'Analyze the image intent and create a visually polished landing page.';
  const currentDocumentBlock = editingCurrentHtml
    ? `Current HTML file to revise:
Path: ${currentFile || projectHtmlPath(projectPath)}
\`\`\`html
${currentHtml && currentHtml.length > 14000 ? `${currentHtml.slice(0, 14000)}\n<!-- truncated current HTML -->` : currentHtml}
\`\`\`

Revision contract:
- Treat the attached image${imageCount > 1 ? 's' : ''} as visual reference material for this existing HTML file.
- Keep the same file as the working target and return a complete updated <!DOCTYPE html> document.
- Preserve useful existing behavior such as MP4 export hooks, renderAtTime, seehtml:export-frame, keyboard controls, and current page count unless the user explicitly asks to change them.
- Fix the mismatch between the current HTML and the image/prompt instead of creating an unrelated new concept.`
    : '';

  return `I am sending ${imageCount} reference image${imageCount > 1 ? 's' : ''}.
Image/OCR routing: ${ocrMode}
Image asset strategy: ${imageAssetStrategyPrompt(effectiveAssetMode, imageCount)}

${ocrText || 'No OCR text was available.'}

Prepared local assets:
${preparedAssetText || 'No prepared image assets were requested or available for this strategy.'}

${currentDocumentBlock}

${userIntent || (hasSubstantialText
    ? 'Generate a complete HTML page that faithfully reproduces the layout, colors, text hierarchy, and visual structure.'
    : fallbackTask)}

When multiple images are provided, treat them as one design/context set unless the user explicitly says otherwise.
Asset usage contract:
- If the strategy is "use-assets", directly reference the prepared local assets by their relative paths in HTML/CSS/JS. Do not recreate the uploaded image from imagination when an asset path is available.
- If the strategy is "hybrid", use full/crop/region assets for backgrounds or key visual objects when they preserve the user's material, then redraw only the parts that should be dynamic, textual, or missing.
- If the strategy is "reference-only", do not embed uploaded image files. Use the image only for composition, color, typography, and style direction.
- Choose assets intelligently by image type: contact sheets/storyboards can use region panels as shots; product/person photos can use cutouts or centered crops; screenshots/posters can use full/cinematic crops as backplates.
- Always use relative paths such as exports/image-assets/image_1/panel_1.png. Never use absolute Windows paths and never depend on external CDN assets.
- Hard validation: when strategy is "use-assets" or "hybrid", the final HTML must contain at least one src/url reference to exports/image-assets/... and the visible scene must be built around that uploaded/cropped material. A page that merely redraws a similar-looking concept without using the supplied material is invalid.
- If the user says crop/cutout/use this image/use material, treat the uploaded image as source footage/art direction that must remain visible in the final result; add motion and camera language around it rather than replacing it with unrelated generated shapes.
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
  const raw = typeof params.format === 'string' && params.format.trim()
    ? params.format
    : (rest.split(/\s+/)[0] || 'pptx');
  const normalized = raw.toLowerCase();
  if (['ppt', 'powerpoint', 'presentation'].includes(normalized)) return 'pptx';
  if (['mp4', 'video', 'movie'].includes(normalized)) return 'video';
  return normalized;
}

function normalizeMp4ExportProfileId(rest: string, params: Record<string, unknown>): Mp4ExportProfileId | null {
  const explicit = toMp4ExportProfileId(params.profileId);
  if (explicit) return explicit;

  const rawProfile = [params.profile, params.quality, params.mode, params.fps, rest]
    .filter((value) => value !== undefined && value !== null)
    .map(String)
    .join(' ');
  const fromText = inferMp4ExportProfileId(rawProfile);
  if (fromText) return fromText;

  const fps = Number(params.fps);
  if (fps === 12) return 'fast';
  if (fps === 15) return 'standard';
  if (fps === 30) return 'quality';
  return null;
}

function startBackgroundDocumentExport({
  html,
  format,
  outputPath,
  projectPath,
}: {
  html: string;
  format: string;
  outputPath: string;
  projectPath: string;
}) {
  const preview = usePreviewStore.getState();
  preview.setRenderStatus({
    state: 'queued',
    message: t('export.documentQueued'),
    outputPath,
  });

  void (async () => {
    preview.setRenderStatus({
      state: 'running',
      message: backgroundExportRunningMessage(format),
      outputPath,
    });

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke('export_document', {
        html,
        format,
        theme: null,
        outputPath,
      });
      notifyProjectFilesChanged(projectPath);
      const exportedPath = extractPath(result) || outputPath;
      preview.setRenderStatus({
        state: 'done',
        message: `${t('chat.exported')} ${exportedPath}`.trim(),
        outputPath: exportedPath,
      });
    } catch (error) {
      preview.setRenderStatus({
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
        outputPath,
      });
    }
  })();
}

function backgroundExportMessage(format: string, outputPath: string): string {
  return `${backgroundExportRunningMessage(format)}\n${t('project.savedTo')}\n${outputPath}`;
}

function backgroundExportRunningMessage(format: string): string {
  if (format === 'pptx') return t('export.pptBackgroundRunning');
  if (format === 'markdown' || format === 'md') return t('export.markdownBackgroundRunning');
  return t('export.documentBackgroundRunning');
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
  const friendlyMessage = friendlyAgentErrorMessage(em);
  const now = new Date().toISOString();
  const errMsg: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'system',
    content: `Error: ${friendlyMessage}`,
    timestamp: now,
    completedAt: now,
    processingTrace: finalizeProcessingTrace(markActiveStepError(get().processingSteps, em, now), 'error', now),
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
