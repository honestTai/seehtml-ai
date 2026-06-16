//! SeeHTML Agents - Multi-agent system for document processing
//!
//! Architecture inspired by Claude Code / Codex agent patterns:
//!   Orchestrator (🎯) → routes tasks, manages workflow
//!   DocumentAgent (📄) → parses and structures HTML documents
//!   ContentAgent (🤖) → AI-powered content generation (DeepSeek)
//!   StyleAgent (🎨) → theme, layout, and styling
//!   MediaAgent (🎬) → video/audio/subtitle processing (FFmpeg)
//!   ExportAgent (📦) → PPTX, Markdown, PNG export
//!   PublishAgent (🚀) → package and share

pub mod orchestrator;
pub mod agent_loop;
pub mod document;
pub mod content;
pub mod style;
pub mod media;
pub mod export_agent;
pub mod publish;

pub use orchestrator::Orchestrator;
pub use orchestrator::AgentInfo;
pub use agent_loop::AgentLoop;

use async_trait::async_trait;
use seehtml_core::*;

/// Core trait that all agents must implement
#[async_trait]
pub trait Agent: Send + Sync {
    /// Unique identifier for this agent
    fn id(&self) -> AgentId;

    /// Human-readable name
    fn name(&self) -> &str {
        self.id().name()
    }

    /// Initialize the agent
    async fn initialize(&mut self) -> Result<()>;

    /// Execute a specific action with parameters
    async fn execute(
        &self,
        action: &str,
        params: serde_json::Value,
        context: &AgentContext,
    ) -> Result<serde_json::Value>;

    /// Get current agent state
    fn state(&self) -> AgentState;

    /// Get capabilities this agent supports
    fn capabilities(&self) -> Vec<AgentCapability>;
}

/// Describes what an agent can do
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentCapability {
    pub action: String,
    pub description: String,
    pub parameters: Vec<CapabilityParameter>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityParameter {
    pub name: String,
    pub param_type: String,
    pub description: String,
    pub required: bool,
}

/// Shared context passed to agents during execution
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentContext {
    pub document: Option<Document>,
    pub config: Option<AiConfig>,
    pub working_dir: Option<std::path::PathBuf>,
    pub previous_results: HashMap<String, serde_json::Value>,
}

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
