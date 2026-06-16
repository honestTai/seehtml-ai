//! ContentAgent - AI-powered content generation via DeepSeek API
use crate::{Agent, AgentCapability, AgentContext, CapabilityParameter};
use async_trait::async_trait;
use seehtml_core::*;
use tracing::info;

pub struct ContentAgent {
    state: AgentState,
    config: AiConfig,
    client: reqwest::Client,
}

impl ContentAgent {
    pub fn new(config: AiConfig) -> Self {
        Self { state: AgentState::Idle, config, client: reqwest::Client::new() }
    }

    async fn call_ai(&self, prompt: &AiPrompt) -> Result<AiResponse> {
        let body = serde_json::json!({
            "model": self.config.model,
            "messages": [
                {"role": "system", "content": prompt.system_prompt},
                {"role": "user", "content": format!("{}

Context: {}", prompt.user_prompt, prompt.context.as_deref().unwrap_or(""))}
            ],
            "temperature": self.config.temperature,
            "max_tokens": self.config.max_tokens,
        });

        let resp = self.client.post(&self.config.api_url)
            .header("Authorization", format!("Bearer {}", self.config.api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| SeeHtmlError::AiApiError(e.to_string()))?;

        let json: serde_json::Value = resp.json().await
            .map_err(|e| SeeHtmlError::AiApiError(e.to_string()))?;

        let content = json["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string();
        let model = json["model"].as_str().unwrap_or(&self.config.model).to_string();
        let usage = json.get("usage").map(|u| AiUsage {
            prompt_tokens: u["prompt_tokens"].as_u64().unwrap_or(0) as u32,
            completion_tokens: u["completion_tokens"].as_u64().unwrap_or(0) as u32,
            total_tokens: u["total_tokens"].as_u64().unwrap_or(0) as u32,
        });

        Ok(AiResponse { content, usage, model })
    }

    async fn generate_slide_content(&self, topic: &str, num_slides: u32) -> Result<Vec<String>> {
        let prompt = AiPrompt {
            system_prompt: "You are an HTML presentation generator. Create complete, well-formatted HTML slides. Each slide must be a self-contained HTML section with heading and content.".into(),
            user_prompt: format!("Generate {} presentation slides about: {}. Output format: Wrap each slide in <section class=\"slide\"> with <h2> for title and <ul>/<p> for content. Use inline CSS for basic styling (font-family: system-ui, colors, etc). Return ONLY the HTML, no markdown wrappers.", num_slides, topic),
            context: Some(r#"Example format:
<section class="slide">
  <h2 style="color:#2563EB;font-size:28px">Slide Title Here</h2>
  <ul style="font-size:18px;line-height:1.8">
    <li>Key point one with details</li>
    <li>Key point two with details</li>
  </ul>
</section>"#.into()),
        };
        let resp = self.call_ai(&prompt).await?;
        // Split by <section class="slide"> and reconstruct
        let slides: Vec<String> = resp.content
            .split("</section>")
            .filter_map(|s| {
                let trimmed = s.trim();
                if trimmed.is_empty() { return None; }
                Some(format!("{}</section>", trimmed))
            })
            .collect();
        if slides.is_empty() {
            Ok(vec![resp.content])
        } else {
            Ok(slides)
        }
    }

    async fn enhance_html_content(&self, html: &str, instructions: &str) -> Result<String> {
        let prompt = AiPrompt {
            system_prompt: "You are an HTML content enhancer. Improve the given HTML content while preserving its structure.".into(),
            user_prompt: format!("Enhance this HTML content. Instructions: {}

HTML:{}", instructions, html),
            context: None,
        };
        let resp = self.call_ai(&prompt).await?;
        Ok(resp.content)
    }
}

#[async_trait]
impl Agent for ContentAgent {
    fn id(&self) -> AgentId { AgentId::Content }
    fn state(&self) -> AgentState { self.state.clone() }

    async fn initialize(&mut self) -> Result<()> {
        self.state = AgentState::Idle;
        info!("ContentAgent initialized with model: {}", self.config.model);
        Ok(())
    }

    async fn execute(&self, action: &str, params: serde_json::Value, ctx: &AgentContext) -> Result<serde_json::Value> {
        match action {
            "generate" => {
                let topic = params.get("topic").and_then(|v| v.as_str()).unwrap_or("Presentation");
                let slides = params.get("slides").and_then(|v| v.as_u64()).unwrap_or(3) as u32;
                let content = self.generate_slide_content(topic, slides).await?;
                Ok(serde_json::json!({"slides": content}))
            }
            "enhance_for_export" => {
                let html = ctx.document.as_ref().map(|d| d.html_content.as_str()).unwrap_or("");
                let instructions = params.get("instructions").and_then(|v| v.as_str()).unwrap_or("Improve readability and formatting");
                let enhanced = self.enhance_html_content(html, instructions).await?;
                Ok(serde_json::json!({"enhanced_html": enhanced}))
            }
            "enhance_html" => {
                let html = params.get("html").and_then(|v| v.as_str()).unwrap_or("");
                let instructions = params.get("instructions").and_then(|v| v.as_str()).unwrap_or("Improve content");
                let enhanced = self.enhance_html_content(html, instructions).await?;
                Ok(serde_json::json!({"enhanced_html": enhanced}))
            }
            _ => Err(SeeHtmlError::AgentError { agent: "ContentAgent".into(), message: format!("Unknown action: {}", action) }),
        }
    }

    fn capabilities(&self) -> Vec<AgentCapability> {
        vec![
            AgentCapability { action: "generate".into(), description: "Generate slide content using AI".into(),
                parameters: vec![CapabilityParameter { name: "topic".into(), param_type: "string".into(), description: "Presentation topic".into(), required: true },
                                 CapabilityParameter { name: "slides".into(), param_type: "number".into(), description: "Number of slides".into(), required: false }] },
            AgentCapability { action: "enhance_html".into(), description: "Enhance HTML content with AI".into(),
                parameters: vec![CapabilityParameter { name: "html".into(), param_type: "string".into(), description: "HTML content".into(), required: true },
                                 CapabilityParameter { name: "instructions".into(), param_type: "string".into(), description: "Enhancement instructions".into(), required: false }] },
        ]
    }
}
