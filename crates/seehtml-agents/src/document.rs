//! DocumentAgent - HTML document parsing and structuring
use crate::{Agent, AgentCapability, AgentContext, CapabilityParameter};
use async_trait::async_trait;
use seehtml_core::*;
use std::path::Path;
use tracing::info;
use uuid::Uuid;

pub struct DocumentAgent { state: AgentState }

impl DocumentAgent {
    pub fn new() -> Self { Self { state: AgentState::Idle } }

    async fn parse_html_file(&self, file_path: &Path) -> Result<Document> {
        info!("Parsing HTML: {}", file_path.display());
        let html_content = tokio::fs::read_to_string(file_path).await?;
        let title = Self::extract_title(&html_content);
        let sections = Self::parse_sections(&html_content);
        Ok(Document {
            id: Uuid::new_v4().to_string(),
            title,
            source_path: Some(file_path.to_path_buf()),
            html_content,
            metadata: DocumentMetadata::default(),
            sections,
            assets: Vec::new(),
            styles: Vec::new(),
        })
    }

    fn extract_title(html: &str) -> String {
        if let Some(start) = html.find("<title>") {
            if let Some(end) = html[start..].find("</title>") {
                return html[start + 7..start + end].trim().to_string();
            }
        }
        // Try first h1
        if let Some(start) = html.find("<h1") {
            if let Some(tag_end) = html[start..].find('>') {
                let content_start = start + tag_end + 1;
                if let Some(end) = html[content_start..].find("</h1>") {
                    return html[content_start..content_start + end].trim().to_string();
                }
            }
        }
        "Untitled Document".into()
    }

    /// Parse HTML into sections based on heading tags (h1-h6) and divs
    fn parse_sections(html: &str) -> Vec<DocumentSection> {
        let mut sections = Vec::new();
        let body = if let Some(b) = html.find("<body") {
            if let Some(gt) = html[b..].find('>') {
                let body_start = b + gt + 1;
                if let Some(body_end) = html[body_start..].find("</body>") {
                    &html[body_start..body_start + body_end]
                } else { html }
            } else { html }
        } else { html };

        // Split by heading tags (h1-h6)
        let heading_patterns = ["<h1", "<h2", "<h3", "<h4", "<h5", "<h6"];
        let mut current_pos = 0;
        while current_pos < body.len() {
            // Find the next heading
            let mut next_heading_pos = body.len();
            let mut next_level = 0u32;
            let mut heading_text = None;

            for (i, pattern) in heading_patterns.iter().enumerate() {
                if let Some(pos) = body[current_pos..].find(pattern) {
                    let abs_pos = current_pos + pos;
                    if abs_pos < next_heading_pos {
                        next_heading_pos = abs_pos;
                        next_level = (i + 1) as u32;
                        // Extract heading text
                        if let Some(gt) = body[abs_pos..].find('>') {
                            let text_start = abs_pos + gt + 1;
                            let close_tag = format!("</h{}>", i + 1);
                            if let Some(close) = body[text_start..].find(&close_tag) {
                                heading_text = Some(body[text_start..text_start + close].trim().to_string());
                            }
                        }
                    }
                }
            }

            if next_heading_pos == body.len() {
                // No more headings — remaining content is a section
                let remaining = body[current_pos..].trim().to_string();
                if !remaining.is_empty() {
                    sections.push(DocumentSection {
                        id: Uuid::new_v4().to_string(),
                        level: 0,
                        heading: None,
                        content: remaining,
                        assets: vec![],
                        style_id: None,
                    });
                }
                break;
            }

            // Content before this heading (if any) goes to previous section or new one
            if next_heading_pos > current_pos {
                let content = body[current_pos..next_heading_pos].trim().to_string();
                if !content.is_empty() {
                    sections.push(DocumentSection {
                        id: Uuid::new_v4().to_string(),
                        level: 0,
                        heading: None,
                        content,
                        assets: vec![],
                        style_id: None,
                    });
                }
            }

            // Find content until next section
            let after_heading = {
                let close_tag = format!("</h{}>", next_level);
                if let Some(close) = body[next_heading_pos..].find(&close_tag) {
                    next_heading_pos + close + close_tag.len()
                } else {
                    next_heading_pos + 1
                }
            };

            // Find content until next heading or end
            let content_end = {
                let mut earliest = body.len();
                for pattern in &heading_patterns {
                    if let Some(pos) = body[after_heading..].find(pattern) {
                        if after_heading + pos < earliest {
                            earliest = after_heading + pos;
                        }
                    }
                }
                earliest
            };

            let content = body[after_heading..content_end].trim().to_string();

            sections.push(DocumentSection {
                id: Uuid::new_v4().to_string(),
                level: next_level,
                heading: heading_text,
                content,
                assets: vec![],
                style_id: None,
            });

            current_pos = content_end;
        }

        // If no sections found, create one with all content
        if sections.is_empty() {
            sections.push(DocumentSection {
                id: Uuid::new_v4().to_string(),
                level: 1,
                heading: Some("Document".into()),
                content: body.trim().to_string(),
                assets: vec![],
                style_id: None,
            });
        }

        sections
    }
}

#[async_trait]
impl Agent for DocumentAgent {
    fn id(&self) -> AgentId { AgentId::Document }
    fn state(&self) -> AgentState { self.state.clone() }
    async fn initialize(&mut self) -> Result<()> { self.state = AgentState::Idle; Ok(()) }

    async fn execute(&self, action: &str, params: serde_json::Value, _ctx: &AgentContext) -> Result<serde_json::Value> {
        match action {
            "parse_html" => {
                let path = params.get("path").and_then(|v| v.as_str())
                    .ok_or_else(|| SeeHtmlError::InvalidDocument("No path provided".into()))?;
                let doc = self.parse_html_file(Path::new(path)).await?;
                Ok(serde_json::to_value(doc)?)
            }
            "read_html_string" => {
                let html = params.get("html").and_then(|v| v.as_str()).unwrap_or("");
                let title = Self::extract_title(html);
                let doc = Document {
                    id: Uuid::new_v4().to_string(),
                    title,
                    source_path: None,
                    html_content: html.to_string(),
                    metadata: DocumentMetadata::default(),
                    sections: Vec::new(),
                    assets: Vec::new(),
                    styles: Vec::new(),
                };
                Ok(serde_json::to_value(doc)?)
            }
            _ => Err(SeeHtmlError::AgentError {
                agent: "DocumentAgent".into(),
                message: format!("Unknown action: {}", action)
            }),
        }
    }

    fn capabilities(&self) -> Vec<AgentCapability> {
        vec![
            AgentCapability {
                action: "parse_html".into(),
                description: "Parse an HTML file into structured document".into(),
                parameters: vec![CapabilityParameter {
                    name: "path".into(), param_type: "string".into(),
                    description: "Path to HTML file".into(), required: true
                }],
            },
            AgentCapability {
                action: "read_html_string".into(),
                description: "Parse HTML string into structured document".into(),
                parameters: vec![CapabilityParameter {
                    name: "html".into(), param_type: "string".into(),
                    description: "Raw HTML content".into(), required: true
                }],
            },
        ]
    }
}
