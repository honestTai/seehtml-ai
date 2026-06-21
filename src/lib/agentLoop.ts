// Agent Loop — Client-side orchestration (Claude Code / Codex style)
//
// Architecture:
//   1. User sends message
//   2. Convert to LlmMessage[], send to backend agent_chat
//   3. Backend LLM decides: text response OR tool_call
//   4. If tool_call: show in UI, execute via backend, append result, loop
//   5. If text: display final response
//
// The loop runs on the backend (Rust) for efficiency, but the frontend
// manages the conversation state and UI updates.

import type { ChatMessage, WorkflowStep } from '../types';

// OpenAI-compatible message format
export interface LlmMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content?: string | null;
  tool_calls?: ToolCall[] | null;
  tool_call_id?: string | null;
  name?: string | null;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  tool_call_id: string;
  name: string;
  result: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AgentLoopResponse {
  messages: LlmMessage[];
  plan?: AgentExecutionPlan;
}

export interface AgentExecutionPlan {
  primary_intent: string;
  task_focus: string;
  steps: string[];
  allowed_tools: string[];
  needs_clarification: boolean;
  clarification_question?: string | null;
  clarification_options: string[];
  wants_html_output: boolean;
  wants_preview_update: boolean;
  wants_video_export: boolean;
  route_reason: string;
}

export type AgentStreamEvent =
  | { type: 'plan'; plan: AgentExecutionPlan }
  | { type: 'thinking'; content: string }
  | { type: 'tool_call'; tool: ToolCall }
  | { type: 'tool_result'; result: ToolResult }
  | { type: 'text'; content: string }
  | { type: 'done'; usage?: unknown }
  | { type: 'error'; message: string };

interface AgentRunEventPayload {
  run_id: string;
  event: AgentStreamEvent;
}

/**
 * Run the agent loop: sends conversation to backend, gets LLM response
 * with tool calling support.
 */
export async function runAgentLoop(
  userMessage: string,
  conversationHistory: ChatMessage[],
  options?: {
    systemPrompt?: string;
    maxIterations?: number;
    toolNames?: string[];
    sessionId?: string | null;
    projectDir?: string | null;
    currentFile?: string | null;
    currentHtml?: string | null;
    memory?: Record<string, string>;
    onEvent?: (event: AgentStreamEvent) => void;
  }
): Promise<{
  assistantContent: string;
  toolCalls: ToolCall[];
  messages: LlmMessage[];
  plan?: AgentExecutionPlan;
}> {
  const { invoke } = await import('@tauri-apps/api/core');
  const tools = await loadToolsForIntent(invoke, options?.toolNames);
  const runId = crypto.randomUUID();
  let unlisten: (() => void) | undefined;

  if (options?.onEvent) {
    const { listen } = await import('@tauri-apps/api/event');
    unlisten = await listen<AgentRunEventPayload>('seehtml-agent-event', ({ payload }) => {
      if (payload?.run_id !== runId) return;
      options.onEvent?.(payload.event);
    });
  }

  // Build LlmMessage array from conversation history + new user message
  const llmMessages: LlmMessage[] = [];

  // Add conversation history
  for (const msg of conversationHistory) {
    if (msg.role === 'user') {
      llmMessages.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'agent') {
      llmMessages.push({ role: 'assistant', content: msg.content });
    }
  }

  // Add the new user message
  llmMessages.push({ role: 'user', content: userMessage });

  let result: unknown;
  try {
    result = await invoke('agent_chat_stream', {
      runId,
      messages: llmMessages,
      tools,
      systemPrompt: options?.systemPrompt || null,
      maxIterations: options?.maxIterations || 10,
      sessionId: options?.sessionId || null,
      projectDir: options?.projectDir || null,
      currentFile: options?.currentFile || null,
      currentHtml: options?.currentHtml || null,
      memory: options?.memory || null,
    });
  } catch (error) {
    if (!options?.onEvent || !isMissingStreamCommandError(error)) throw error;
    result = await invoke('agent_chat', {
      messages: llmMessages,
      tools,
      systemPrompt: options?.systemPrompt || null,
      maxIterations: options?.maxIterations || 10,
      sessionId: options?.sessionId || null,
      projectDir: options?.projectDir || null,
      currentFile: options?.currentFile || null,
      currentHtml: options?.currentHtml || null,
      memory: options?.memory || null,
    });
  } finally {
    unlisten?.();
  }

  const response = result as AgentLoopResponse | LlmMessage[];
  const responseMessages = Array.isArray(response) ? response : response.messages || [];
  const plan = Array.isArray(response) ? undefined : response.plan;

  // Extract the final assistant text response and any tool calls
  let assistantContent = '';
  const toolCalls: ToolCall[] = [];

  for (const msg of responseMessages) {
    if (msg.role === 'assistant') {
      if (msg.content) {
        assistantContent = msg.content;
      }
      if (msg.tool_calls) {
        toolCalls.push(...msg.tool_calls);
      }
    }
  }

  return {
    assistantContent,
    toolCalls,
    messages: responseMessages,
    plan,
  };
}

let cachedTools: ToolDefinition[] | null = null;

async function loadToolsForIntent(
  invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>,
  toolNames?: string[],
): Promise<ToolDefinition[] | null> {
  if (!toolNames) return null;
  if (toolNames.length === 0) return [];

  if (!cachedTools) {
    cachedTools = await invoke<ToolDefinition[]>('get_tools');
  }

  const allowed = new Set(toolNames);
  return cachedTools.filter((tool) => allowed.has(tool.name));
}

function isMissingStreamCommandError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /agent_chat_stream|command.*not.*found|unknown command|not found/i.test(text);
}

/**
 * Convert LlmMessages to display-friendly ChatMessage array
 */
export function llmMessagesToChatMessages(
  llmMessages: LlmMessage[],
): ChatMessage[] {
  const chatMessages: ChatMessage[] = [];

  for (const msg of llmMessages) {
    if (msg.role === 'user' && msg.content) {
      chatMessages.push({
        id: crypto.randomUUID(),
        role: 'user',
        content: msg.content,
        timestamp: new Date().toISOString(),
      });
    }
    if (msg.role === 'assistant') {
      if (msg.content) {
        chatMessages.push({
          id: crypto.randomUUID(),
          role: 'agent',
          content: msg.content,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  return chatMessages;
}
