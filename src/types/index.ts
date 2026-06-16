export interface AgentInfo {
  id: string;
  name: string;
  emoji: string;
  state: AgentState;
  capabilities: AgentCapability[];
}

export type AgentState = "Idle" | "Initializing" | "Running" | "Waiting" | "Completed" | { Failed: string };

export interface AgentCapability {
  action: string;
  description: string;
  parameters: CapabilityParameter[];
}

export interface CapabilityParameter {
  name: string;
  param_type: string;
  description: string;
  required: boolean;
}

export interface WorkflowStep {
  id: string;
  agent: string;
  action: string;
  parameters: unknown;
  depends_on: string[];
  status: string | { Failed: string };
  result: unknown;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "system";
  content: string;
  imageDataUrl?: string;
  agentId?: string;
  agentName?: string;
  agentEmoji?: string;
  timestamp: string;
  workflow?: WorkflowStep[];
  toolEvents?: AgentToolEvent[];
}

export interface AgentToolEvent {
  id: string;
  name: string;
  arguments?: unknown;
  result?: unknown;
  error?: string;
}

export interface DocumentInfo {
  id: string;
  title: string;
  sections: number;
  assets: number;
}

export interface FileTreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileTreeNode[];
  loaded: boolean;
}
