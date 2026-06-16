//! Agent Orchestrator - Central coordination for multi-agent workflows
//!
//! Routes user intent to specialized agents, manages dependencies,
//! and aggregates results. Inspired by Claude Code's dispatch model.

use crate::{Agent, AgentCapability, AgentContext};
use seehtml_core::*;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, error};
use uuid::Uuid;

pub struct Orchestrator {
    agents: HashMap<AgentId, Arc<dyn Agent>>,
    active_workflows: RwLock<HashMap<String, Workflow>>,
    pub results_cache: RwLock<HashMap<String, serde_json::Value>>,
}

impl Orchestrator {
    pub fn new() -> Self {
        Self {
            agents: HashMap::new(),
            active_workflows: RwLock::new(HashMap::new()),
            results_cache: RwLock::new(HashMap::new()),
        }
    }

    pub fn register(&mut self, agent: Arc<dyn Agent>) {
        info!("Registering agent: {}", agent.name());
        self.agents.insert(agent.id(), agent);
    }

    pub async fn list_agents(&self) -> Vec<AgentInfo> {
        self.agents.iter().map(|(id, agent)| AgentInfo {
            id: id.clone(),
            name: agent.name().to_string(),
            emoji: id.emoji().to_string(),
            state: agent.state(),
            capabilities: agent.capabilities(),
        }).collect()
    }

    pub async fn plan(&self, request: &UserRequest) -> Result<Workflow> {
        info!("Planning workflow for: {}", request.command);
        let steps = match request.command.as_str() {
            "open" | "load" => self.plan_document_load(&request.parameters).await?,
            "export" | "convert" => self.plan_export(&request.parameters).await?,
            "style" | "theme" => self.plan_style_change(&request.parameters).await?,
            "ai" | "generate" => self.plan_content_generation(&request.parameters).await?,
            "publish" | "package" => self.plan_publish(&request.parameters).await?,
            "media" => self.plan_media_processing(&request.parameters).await?,
            "ocr" => self.plan_ocr(&request.parameters).await?,
            _ => self.plan_auto(request).await?,
        };
        let workflow = Workflow {
            id: Uuid::new_v4().to_string(),
            name: format!("Workflow: {}", request.command),
            description: request.parameters.to_string(),
            steps,
            status: WorkflowStatus::Pending,
            created_at: chrono::Utc::now().to_rfc3339(),
            updated_at: chrono::Utc::now().to_rfc3339(),
        };
        self.active_workflows.write().await.insert(workflow.id.clone(), workflow.clone());
        Ok(workflow)
    }

    pub async fn execute_workflow(&self, workflow_id: &str, context: &AgentContext) -> Result<Vec<WorkflowStep>> {
        let mut workflow = self.active_workflows.read().await.get(workflow_id).cloned()
            .ok_or_else(|| SeeHtmlError::OrchestrationError("Workflow not found".into()))?;
        let mut results = Vec::new();
        for step in workflow.steps.iter_mut() {
            if step.status != WorkflowStatus::Pending { continue; }
            let deps_ready = step.depends_on.iter().all(|dep_id| {
                results.iter().any(|s: &WorkflowStep| s.id == *dep_id && s.status == WorkflowStatus::Completed)
            });
            if !deps_ready && !step.depends_on.is_empty() { step.status = WorkflowStatus::Skipped; results.push(step.clone()); continue; }
            info!("Executing: {} -> {}", step.agent.name(), step.action);
            step.status = WorkflowStatus::Running;
            match self.dispatch(&step.agent, &step.action, &step.parameters, context).await {
                Ok(output) => { step.status = WorkflowStatus::Completed; step.result = Some(output.clone()); self.results_cache.write().await.insert(step.id.clone(), output); }
                Err(e) => { error!("Step {} failed: {}", step.id, e); step.status = WorkflowStatus::Failed(e.to_string()); }
            }
            results.push(step.clone());
        }
        Ok(results)
    }

    pub async fn dispatch(&self, agent_id: &AgentId, action: &str, params: &serde_json::Value, context: &AgentContext) -> Result<serde_json::Value> {
        let agent = self.agents.get(agent_id).ok_or_else(|| SeeHtmlError::AgentError { agent: agent_id.name().into(), message: "Agent not registered".into() })?;
        agent.execute(action, params.clone(), context).await
    }

    async fn plan_document_load(&self, params: &serde_json::Value) -> Result<Vec<WorkflowStep>> {
        Ok(vec![WorkflowStep { id: Uuid::new_v4().to_string(), agent: AgentId::Document, action: "parse_html".into(), parameters: params.clone(), depends_on: vec![], status: WorkflowStatus::Pending, result: None }])
    }

    async fn plan_export(&self, params: &serde_json::Value) -> Result<Vec<WorkflowStep>> {
        let fmt = params.get("format").and_then(|v| v.as_str()).unwrap_or("pptx");
        let _text_val = params.get("text").and_then(|v| v.as_str()).unwrap_or("");
        let ai_id = Uuid::new_v4().to_string();
        let exp_id = Uuid::new_v4().to_string();

        // For video export: media → export chain
        if fmt == "video" {
            let media_id = Uuid::new_v4().to_string();
            return Ok(vec![
                WorkflowStep { id: media_id.clone(), agent: AgentId::Media, action: "generate_video".into(), parameters: params.clone(), depends_on: vec![], status: WorkflowStatus::Pending, result: None },
                WorkflowStep { id: exp_id, agent: AgentId::Export, action: "export_html".into(), parameters: params.clone(), depends_on: vec![media_id], status: WorkflowStatus::Pending, result: None },
            ]);
        }

        // For PNG/image export
        if fmt == "png" {
            return Ok(vec![
                WorkflowStep { id: exp_id, agent: AgentId::Export, action: "export_png".into(), parameters: params.clone(), depends_on: vec![], status: WorkflowStatus::Pending, result: None },
            ]);
        }

        // Default: AI enhance → export (PPtX, Markdown, HTML)
        Ok(vec![
            WorkflowStep { id: ai_id.clone(), agent: AgentId::Content, action: "enhance_for_export".into(), parameters: params.clone(), depends_on: vec![], status: WorkflowStatus::Pending, result: None },
            WorkflowStep { id: exp_id, agent: AgentId::Export, action: format!("export_{}", fmt), parameters: params.clone(), depends_on: vec![ai_id], status: WorkflowStatus::Pending, result: None },
        ])
    }

    async fn plan_content_generation(&self, params: &serde_json::Value) -> Result<Vec<WorkflowStep>> {
        Ok(vec![WorkflowStep { id: Uuid::new_v4().to_string(), agent: AgentId::Content, action: "generate".into(), parameters: params.clone(), depends_on: vec![], status: WorkflowStatus::Pending, result: None }])
    }

    async fn plan_style_change(&self, params: &serde_json::Value) -> Result<Vec<WorkflowStep>> {
        Ok(vec![WorkflowStep { id: Uuid::new_v4().to_string(), agent: AgentId::Style, action: "apply_theme".into(), parameters: params.clone(), depends_on: vec![], status: WorkflowStatus::Pending, result: None }])
    }

    async fn plan_publish(&self, params: &serde_json::Value) -> Result<Vec<WorkflowStep>> {
        Ok(vec![WorkflowStep { id: Uuid::new_v4().to_string(), agent: AgentId::Publish, action: "package".into(), parameters: params.clone(), depends_on: vec![], status: WorkflowStatus::Pending, result: None }])
    }

    async fn plan_media_processing(&self, params: &serde_json::Value) -> Result<Vec<WorkflowStep>> {
        Ok(vec![WorkflowStep { id: Uuid::new_v4().to_string(), agent: AgentId::Media, action: "process".into(), parameters: params.clone(), depends_on: vec![], status: WorkflowStatus::Pending, result: None }])
    }

    async fn plan_ocr(&self, params: &serde_json::Value) -> Result<Vec<WorkflowStep>> {
        Ok(vec![WorkflowStep { id: Uuid::new_v4().to_string(), agent: AgentId::Media, action: "ocr".into(), parameters: params.clone(), depends_on: vec![], status: WorkflowStatus::Pending, result: None }])
    }

    async fn plan_auto(&self, _params: &UserRequest) -> Result<Vec<WorkflowStep>> {
        Err(SeeHtmlError::OrchestrationError("Unknown command. Try: open, export, style, ai, publish, media".into()))
    }
}

impl Default for Orchestrator {
    fn default() -> Self { Self::new() }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AgentInfo {
    pub id: AgentId,
    pub name: String,
    pub emoji: String,
    pub state: AgentState,
    pub capabilities: Vec<AgentCapability>,
}
