//! StyleAgent - Theme application and style transformation
use crate::{Agent, AgentCapability, AgentContext, CapabilityParameter};
use async_trait::async_trait;
use seehtml_core::*;

pub struct StyleAgent { state: AgentState }

impl StyleAgent {
    pub fn new() -> Self { Self { state: AgentState::Idle } }

    fn apply_theme_to_html(html: &str, theme: &PresentationTheme) -> String {
        let css = format!(
            r#"<style id="seehtml-theme">
             :root {{
               --primary: {};
               --secondary: {};
               --font-family: '{}';
               --font-size-base: {}px;
               color-scheme: {};
             }}
             body {{ font-family: var(--font-family); font-size: var(--font-size-base); }}
             h1, h2, h3, h4 {{ color: var(--primary); }}
             a {{ color: var(--secondary); }}
             </style>"#,
            theme.primary_color,
            theme.secondary_color,
            theme.font_family,
            theme.font_size_base,
            if theme.dark_mode { "dark" } else { "light" }
        );
        if let Some(head_end) = html.find("</head>") {
            format!("{}{}{}", &html[..head_end], css, &html[head_end..])
        } else if let Some(body_start) = html.find("<body") {
            if let Some(after_tag) = html[body_start..].find('>') {
                let insert = body_start + after_tag + 1;
                format!("{}{}{}", &html[..insert], css, &html[insert..])
            } else { html.to_string() }
        } else { html.to_string() }
    }
}

#[async_trait]
impl Agent for StyleAgent {
    fn id(&self) -> AgentId { AgentId::Style }
    fn state(&self) -> AgentState { self.state.clone() }
    async fn initialize(&mut self) -> Result<()> { self.state = AgentState::Idle; Ok(()) }

    async fn execute(&self, action: &str, params: serde_json::Value, ctx: &AgentContext) -> Result<serde_json::Value> {
        match action {
            "apply_theme" => {
                let theme: PresentationTheme = if let Some(t) = params.get("theme") {
                    serde_json::from_value(t.clone())?
                } else { PresentationTheme::default() };
                let html = ctx.document.as_ref().map(|d| d.html_content.as_str()).unwrap_or("");
                let styled = Self::apply_theme_to_html(html, &theme);
                Ok(serde_json::json!({"styled_html": styled, "theme": serde_json::to_value(&theme)?}))
            }
            _ => Err(SeeHtmlError::AgentError { agent: "StyleAgent".into(), message: format!("Unknown action: {}", action) }),
        }
    }

    fn capabilities(&self) -> Vec<AgentCapability> {
        vec![AgentCapability { action: "apply_theme".into(), description: "Apply a presentation theme".into(),
            parameters: vec![CapabilityParameter { name: "theme".into(), param_type: "object".into(), description: "Theme configuration".into(), required: false }] }]
    }
}
