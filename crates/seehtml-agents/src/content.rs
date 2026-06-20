//! ContentAgent - AI-powered content generation via an OpenAI-compatible API
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
        if self.config.api_key.trim().is_empty() {
            return Err(SeeHtmlError::AiApiError(
                "AI API key is not configured. Set SEEHTML_AI_API_KEY or create ai-config.json."
                    .into(),
            ));
        }

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
            system_prompt: r#"You are SeeHTML Frontend Slides Skill.
Create polished, production-quality, directly previewable HTML decks.
Return HTML only. Do not use Markdown fences.
Quality gate:
- Build a complete visual story with strong hierarchy, not plain bullet dumps.
- Include responsive CSS, viewport-safe slide sizing, polished spacing, and readable contrast.
- Each slide must fit the viewport without text overlap or horizontal scrolling.
- Prefer inline CSS and inline JavaScript only; avoid external network dependencies.
- Use semantic structure, accessible labels when useful, and reduced-motion handling when animation is present.
- The output must work inside an iframe preview."#.into(),
            user_prompt: format!(
                r#"Generate {} high-quality HTML slides about: {}.

Output format:
- Return one complete <!DOCTYPE html> document.
- Use <section class="slide"> for each slide.
- Include a fixed or sticky navigation control only if it improves the experience.
- Include a refined visual system: typography, colors, layout rhythm, responsive constraints, and meaningful decorative elements.
- If the topic implies motion, particles, Canvas, video, or MP4 export, use a deterministic Canvas timeline: define renderAtTime(seconds), assign window.renderAtTime, listen for "seehtml:export-frame", and render from event.detail.time or window.__SEEHTML_EXPORT_TIME__.
- For video-like HTML, expose window.__SEEHTML_EXPORT_DURATION__ and render frames from absolute time rather than accumulated deltas.
- Return ONLY the HTML document."#,
                num_slides, topic
            ),
            context: Some(r#"Example format:
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Deck title</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; overflow: hidden; }
    .deck { height: 100vh; overflow-y: auto; scroll-snap-type: y mandatory; }
    .slide { min-height: 100vh; scroll-snap-align: start; padding: clamp(32px, 6vw, 88px); box-sizing: border-box; }
  </style>
</head>
<body>
  <main class="deck">
    <section class="slide"><h1>Slide Title</h1><p>Clear story content.</p></section>
  </main>
</body>
</html>"#.into()),
        };
        let resp = self.call_ai(&prompt).await?;
        let trimmed = resp.content.trim();
        if trimmed.to_lowercase().contains("<!doctype html") || trimmed.to_lowercase().contains("<html") {
            return Ok(vec![trimmed.to_string()]);
        }

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
