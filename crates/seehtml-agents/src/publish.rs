use crate::{Agent, AgentCapability, AgentContext};
use async_trait::async_trait;
use seehtml_core::*;

pub struct PublishAgent { state: AgentState }

impl PublishAgent {
    pub fn new() -> Self { Self { state: AgentState::Idle } }

    async fn package(doc: &Document, out_dir: &str) -> Result<String> {
        let dir = std::path::PathBuf::from(out_dir).join(&doc.title);
        tokio::fs::create_dir_all(&dir).await?;
        tokio::fs::write(dir.join("index.html"), &doc.html_content).await?;
        let assets_dir = dir.join("assets");
        tokio::fs::create_dir_all(&assets_dir).await?;
        for asset in &doc.assets {
            if let Some(data) = &asset.data { tokio::fs::write(assets_dir.join(&asset.name), data).await?; }
        }
        Ok(dir.to_string_lossy().to_string())
    }
}

#[async_trait]
impl Agent for PublishAgent {
    fn id(&self) -> AgentId { AgentId::Publish }
    fn state(&self) -> AgentState { self.state.clone() }
    async fn initialize(&mut self) -> Result<()> { self.state = AgentState::Idle; Ok(()) }
    async fn execute(&self, action: &str, params: serde_json::Value, ctx: &AgentContext) -> Result<serde_json::Value> {
        let doc = ctx.document.as_ref().ok_or_else(|| SeeHtmlError::InvalidDocument("No document".into()))?;
        match action {
            "package" => {
                let out = params.get("output_dir").and_then(|v| v.as_str()).unwrap_or("./output");
                let path = Self::package(doc, out).await?;
                Ok(serde_json::json!({"package_path": path}))
            }
            _ => Err(SeeHtmlError::AgentError { agent: "PublishAgent".into(), message: format!("Unknown: {}", action) }),
        }
    }
    fn capabilities(&self) -> Vec<AgentCapability> {
        vec![AgentCapability { action: "package".into(), description: "Package document".into(), parameters: vec![] }]
    }
}