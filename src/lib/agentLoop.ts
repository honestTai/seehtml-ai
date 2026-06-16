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
  }
): Promise<{
  assistantContent: string;
  toolCalls: ToolCall[];
  messages: LlmMessage[];
}> {
  const { invoke } = await import('@tauri-apps/api/core');
  const tools = await loadToolsForIntent(invoke, options?.toolNames);

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

  // Call backend agent_chat
  const result = await invoke('agent_chat', {
    messages: llmMessages,
    tools,
    systemPrompt: options?.systemPrompt || null,
    maxIterations: options?.maxIterations || 10,
  });

  const response = result as AgentLoopResponse;
  const responseMessages = response.messages || response as unknown as LlmMessage[];

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
