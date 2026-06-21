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
  imageDataUrls?: string[];
  agentId?: string;
  agentName?: string;
  agentEmoji?: string;
  timestamp: string;
  workflow?: WorkflowStep[];
  toolEvents?: AgentToolEvent[];
  processingTrace?: ProcessingStep[];
  qualityChecks?: QualityCheckResult[];
  startedAt?: string;
  completedAt?: string;
  clarification?: ClarificationPrompt;
}

export interface ClarificationPrompt {
  question: string;
  options: ClarificationOption[];
  originalRequest?: string;
  imageDataUrls?: string[];
}

export interface ClarificationOption {
  label: string;
  description?: string;
  recommended?: boolean;
  reply?: string;
  command?: string;
  params?: unknown;
}

export type ProcessingStepStatus = "pending" | "active" | "done" | "error";

export interface ProcessingStep {
  id: string;
  title: string;
  detail: string;
  status: ProcessingStepStatus;
  startedAt?: string;
  completedAt?: string;
  artifacts?: ProcessingArtifact[];
}

export interface ProcessingArtifact {
  id: string;
  label: string;
  path?: string;
  detail?: string;
  stats?: string;
}

export interface QualityCheckResult {
  id: string;
  label: string;
  passed: boolean;
}

export interface QueuedRequest {
  id: string;
  kind: "message" | "command";
  content: string;
  imageDataUrl?: string;
  imageDataUrls?: string[];
  params?: unknown;
  createdAt: string;
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
