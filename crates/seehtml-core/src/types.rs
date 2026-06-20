use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub id: String,
    pub title: String,
    pub source_path: Option<PathBuf>,
    pub html_content: String,
    pub metadata: DocumentMetadata,
    pub sections: Vec<DocumentSection>,
    pub assets: Vec<Asset>,
    pub styles: Vec<StyleDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DocumentMetadata {
    pub author: Option<String>,
    pub created_at: Option<String>,
    pub modified_at: Option<String>,
    pub tags: Vec<String>,
    pub language: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentSection {
    pub id: String,
    pub level: u32,
    pub heading: Option<String>,
    pub content: String,
    pub assets: Vec<String>,
    pub style_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Asset {
    pub id: String,
    pub name: String,
    pub asset_type: AssetType,
    pub path: Option<PathBuf>,
    pub data: Option<Vec<u8>>,
    pub metadata: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AssetType {
    Image,
    Video,
    Audio,
    Subtitle,
    Font,
    Icon,
    Other(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StyleDefinition {
    pub id: String,
    pub name: String,
    pub selector: String,
    pub properties: HashMap<String, String>,
}

// ── Agent System Types ──

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Hash, Eq)]
pub enum AgentId {
    Orchestrator,
    Document,
    Content,
    Style,
    Media,
    Export,
    Publish,
}

impl AgentId {
    pub fn name(&self) -> &'static str {
        match self {
            AgentId::Orchestrator => "Orchestrator",
            AgentId::Document => "DocumentAgent",
            AgentId::Content => "ContentAgent",
            AgentId::Style => "StyleAgent",
            AgentId::Media => "MediaAgent",
            AgentId::Export => "ExportAgent",
            AgentId::Publish => "PublishAgent",
        }
    }
    pub fn emoji(&self) -> &'static str {
        match self {
            AgentId::Orchestrator => "🎯",
            AgentId::Document => "📄",
            AgentId::Content => "🤖",
            AgentId::Style => "🎨",
            AgentId::Media => "🎬",
            AgentId::Export => "📦",
            AgentId::Publish => "🚀",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AgentState {
    Idle,
    Initializing,
    Running,
    Waiting,
    Completed,
    Failed(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMessage {
    pub id: String,
    pub from: AgentId,
    pub to: AgentId,
    pub msg_type: MessageType,
    pub payload: serde_json::Value,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum MessageType {
    Request,
    Response,
    Event,
    Error,
    Status,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStep {
    pub id: String,
    pub agent: AgentId,
    pub action: String,
    pub parameters: serde_json::Value,
    pub depends_on: Vec<String>,
    pub status: WorkflowStatus,
    pub result: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum WorkflowStatus {
    Pending,
    Queued,
    Running,
    Completed,
    Skipped,
    Failed(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workflow {
    pub id: String,
    pub name: String,
    pub description: String,
    pub steps: Vec<WorkflowStep>,
    pub status: WorkflowStatus,
    pub created_at: String,
    pub updated_at: String,
}

// ── Export & Presentation Types ──

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ExportFormat {
    Pptx,
    Markdown,
    Png,
    Html,
    Pdf,
    Video,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportOptions {
    pub format: ExportFormat,
    pub output_path: Option<PathBuf>,
    pub theme: Option<PresentationTheme>,
    pub quality: Option<u32>,
    pub include_assets: bool,
    pub custom_styles: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresentationTheme {
    pub name: String,
    pub primary_color: String,
    pub secondary_color: String,
    pub accent_colors: Vec<String>,
    pub font_family: String,
    pub font_size_base: u32,
    pub dark_mode: bool,
}

impl Default for PresentationTheme {
    fn default() -> Self {
        Self {
            name: "SeeHTML Default".into(),
            primary_color: "#2563EB".into(),
            secondary_color: "#22C7A9".into(),
            accent_colors: vec![
                "#F59E0B".into(),
                "#EF4444".into(),
                "#64748B".into(),
                "#CBD5E1".into(),
            ],
            font_family: "Microsoft YaHei UI".into(),
            font_size_base: 16,
            dark_mode: false,
        }
    }
}

// ── AI Types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    pub api_url: String,
    pub api_key: String,
    pub model: String,
    pub temperature: f64,
    pub max_tokens: u32,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            api_url: "https://4router.net/v1/chat/completions".into(),
            api_key: String::new(),
            model: "gpt-5.5".into(),
            temperature: 0.7,
            max_tokens: 8192,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiPrompt {
    pub system_prompt: String,
    pub user_prompt: String,
    pub context: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiResponse {
    pub content: String,
    pub usage: Option<AiUsage>,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

// ── Media Types ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaInfo {
    pub path: PathBuf,
    pub media_type: AssetType,
    pub duration_secs: Option<f64>,
    pub codec: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub bitrate: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtitleEntry {
    pub index: u32,
    pub start_time: String,
    pub end_time: String,
    pub text: String,
}

// ── Skill System ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub id: String,
    pub name: String,
    pub description: String,
    pub prompt_template: String,
    pub parameters: HashMap<String, SkillParameter>,
    pub category: SkillCategory,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillParameter {
    pub name: String,
    pub param_type: String,
    pub description: String,
    pub required: bool,
    pub default: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SkillCategory {
    ContentGeneration,
    StyleTransformation,
    MediaProcessing,
    DataExtraction,
    FormatConversion,
    Custom(String),
}

// ── User Request Pipeline ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserRequest {
    pub id: String,
    pub command: String,
    pub parameters: serde_json::Value,
    pub context: RequestContext,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RequestContext {
    pub current_file: Option<PathBuf>,
    pub selected_text: Option<String>,
    pub viewport_section: Option<String>,
    pub conversation_history: Vec<String>,
}

// ── Tool Calling (OpenAI/Claude function-calling format) ──

/// A tool definition exposed to the LLM for function calling
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value, // JSON Schema object
}

/// A single tool call requested by the LLM
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

/// Result of executing a tool
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub tool_call_id: String,
    pub name: String,
    pub result: serde_json::Value,
}

/// A message in the LLM conversation (OpenAI format)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmMessage {
    pub role: String, // "user", "assistant", "tool", "system"
    pub content: Option<String>,
    pub tool_calls: Option<Vec<ToolCall>>,
    pub tool_call_id: Option<String>,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemorySnippet {
    pub key: String,
    pub value: String,
    pub source: Option<String>,
}

/// Runtime context supplied by the UI for one agent turn.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentRuntimeContext {
    pub session_id: Option<String>,
    pub project_dir: Option<PathBuf>,
    pub current_file: Option<PathBuf>,
    pub current_document: Option<Document>,
    pub selected_text: Option<String>,
    pub memory_snippets: Vec<MemorySnippet>,
    pub previous_results: HashMap<String, serde_json::Value>,
}

/// Request for the agent loop
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentLoopRequest {
    pub messages: Vec<LlmMessage>,
    pub tools: Vec<ToolDefinition>,
    pub system_prompt: Option<String>,
    pub max_iterations: u32,
    #[serde(default)]
    pub runtime_context: AgentRuntimeContext,
}

/// FlowMark-style plan produced before the executable agent loop.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentExecutionPlan {
    pub primary_intent: String,
    pub task_focus: String,
    pub steps: Vec<String>,
    pub allowed_tools: Vec<String>,
    pub needs_clarification: bool,
    pub clarification_question: Option<String>,
    pub clarification_options: Vec<String>,
    pub wants_html_output: bool,
    pub wants_preview_update: bool,
    pub wants_video_export: bool,
    pub route_reason: String,
}

impl Default for AgentExecutionPlan {
    fn default() -> Self {
        Self {
            primary_intent: "chat".into(),
            task_focus: "Answer the user directly.".into(),
            steps: vec!["Understand the request".into(), "Respond directly".into()],
            allowed_tools: Vec::new(),
            needs_clarification: false,
            clarification_question: None,
            clarification_options: Vec::new(),
            wants_html_output: false,
            wants_preview_update: false,
            wants_video_export: false,
            route_reason: "Normal conversation does not need tools.".into(),
        }
    }
}

/// Full response from the planned agent loop.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlannedAgentLoopResponse {
    pub messages: Vec<LlmMessage>,
    pub plan: AgentExecutionPlan,
}

/// Response from the agent loop (one step)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentLoopResponse {
    pub done: bool,
    pub message: Option<LlmMessage>,
    pub tool_results: Option<Vec<ToolResult>>,
    pub usage: Option<AiUsage>,
}

/// Event emitted during streaming agent loop
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AgentLoopEvent {
    #[serde(rename = "thinking")]
    Thinking { content: String },
    #[serde(rename = "tool_call")]
    ToolCall { tool: ToolCall },
    #[serde(rename = "tool_result")]
    ToolResult { result: ToolResult },
    #[serde(rename = "text")]
    Text { content: String },
    #[serde(rename = "done")]
    Done { usage: Option<AiUsage> },
    #[serde(rename = "error")]
    Error { message: String },
}

