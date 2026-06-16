//! Agent Loop — LLM-based tool-calling orchestration with REAL tool execution
//!
//! Architecture (Claude Code / Codex style):
//!   1. Build tool definitions from registered agents
//!   2. Send conversation + tools to LLM
//!   3. LLM responds with text OR tool_calls
//!   4. If tool_calls: DISPATCH to actual agents via Orchestrator, append REAL results
//!   5. If text: final response, done
//!
//! Uses a dispatch callback so the caller (Tauri commands) can inject the Orchestrator.

use seehtml_core::*;
use std::collections::HashMap;
use std::sync::Arc;
use tracing::info;
use tokio::sync::mpsc;

/// Callback type for executing a tool. Returns the tool result as JSON.
pub type ToolDispatcher = Arc<
    dyn Fn(&str, &str, serde_json::Value) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<serde_json::Value>> + Send>>
    + Send + Sync
>;

pub struct AgentLoop {
    pub config: AiConfig,
    pub client: reqwest::Client,
    pub dispatcher: Option<ToolDispatcher>,
}

impl AgentLoop {
    pub fn new(config: AiConfig) -> Self {
        Self { config, client: reqwest::Client::new(), dispatcher: None }
    }

    pub fn with_dispatcher(mut self, dispatcher: ToolDispatcher) -> Self {
        self.dispatcher = Some(dispatcher);
        self
    }

    /// Build OpenAI function-calling tool definitions from registered agents
    pub fn build_tools(
        agents: &HashMap<AgentId, Vec<AgentCapability>>
    ) -> Vec<ToolDefinition> {
        let mut tools = Vec::new();
        for (agent_id, capabilities) in agents {
            for cap in capabilities {
                let param_schema = build_json_schema(&cap.parameters, agent_id);
                let short_name = agent_id.name().to_lowercase().replace("agent", "");
                tools.push(ToolDefinition {
                    name: format!("{}_{}", short_name, cap.action),
                    description: format!("{} {}", agent_id.emoji(), cap.description),
                    parameters: param_schema,
                });
            }
        }
        tools
    }

    /// Batch mode: run agent loop, execute tools via dispatcher
    pub async fn chat(
        &self,
        request: AgentLoopRequest,
    ) -> Result<Vec<LlmMessage>> {
        let mut messages = request.messages;
        let tools = &request.tools;
        let max_iter = request.max_iterations.max(1).min(20);

        let system_msg = LlmMessage {
            role: "system".into(),
            content: request.system_prompt.clone(),
            tool_calls: None, tool_call_id: None, name: None,
        };

        let mut full_messages = vec![system_msg];
        full_messages.append(&mut messages);

        for _i in 0..max_iter {
            let response = self.call_llm(&full_messages, tools).await?;

            match response {
                LlmResponse::Text(text) => {
                    full_messages.push(LlmMessage {
                        role: "assistant".into(),
                        content: Some(text),
                        tool_calls: None, tool_call_id: None, name: None,
                    });
                    break;
                }
                LlmResponse::ToolCalls(tool_calls) => {
                    full_messages.push(LlmMessage {
                        role: "assistant".into(),
                        content: None,
                        tool_calls: Some(tool_calls.clone()),
                        tool_call_id: None, name: None,
                    });

                    for tc in &tool_calls {
                        // EXECUTE the tool via dispatcher (or fall back to fake result)
                        let result = if let Some(ref dispatcher) = self.dispatcher {
                            let (agent_name, action) = parse_tool_name(&tc.name);
                            match dispatcher(&agent_name, &action, tc.arguments.clone()).await {
                                Ok(val) => val,
                                Err(e) => serde_json::json!({"error": e.to_string()})
                            }
                        } else {
                            serde_json::json!({"status": "ok", "note": "no dispatcher configured"})
                        };

                        let result_str = serde_json::to_string(&result).unwrap_or_default();

                        full_messages.push(LlmMessage {
                            role: "tool".into(),
                            content: Some(result_str),
                            tool_calls: None,
                            tool_call_id: Some(tc.id.clone()),
                            name: Some(tc.name.clone()),
                        });
                    }
                }
            }
        }

        Ok(full_messages)
    }

    /// Streaming mode with real tool execution
    pub async fn chat_stream(
        &self,
        request: AgentLoopRequest,
        tx: mpsc::Sender<AgentLoopEvent>,
    ) -> Result<()> {
        let mut messages = request.messages;
        let tools = &request.tools;
        let max_iter = request.max_iterations.max(1).min(20);

        let system_msg = LlmMessage {
            role: "system".into(),
            content: request.system_prompt.clone(),
            tool_calls: None, tool_call_id: None, name: None,
        };

        let mut full_messages = vec![system_msg];
        full_messages.append(&mut messages);

        for _i in 0..max_iter {
            let _ = tx.send(AgentLoopEvent::Thinking {
                content: "Analyzing request...".into()
            }).await;

            let response = self.call_llm(&full_messages, tools).await?;

            match response {
                LlmResponse::Text(text) => {
                    let _ = tx.send(AgentLoopEvent::Text { content: text.clone() }).await;
                    full_messages.push(LlmMessage {
                        role: "assistant".into(),
                        content: Some(text),
                        tool_calls: None, tool_call_id: None, name: None,
                    });
                    break;
                }
                LlmResponse::ToolCalls(tool_calls) => {
                    for tc in &tool_calls {
                        let _ = tx.send(AgentLoopEvent::ToolCall { tool: tc.clone() }).await;
                    }

                    full_messages.push(LlmMessage {
                        role: "assistant".into(),
                        content: None,
                        tool_calls: Some(tool_calls.clone()),
                        tool_call_id: None, name: None,
                    });

                    for tc in &tool_calls {
                        // Real execution via dispatcher
                        let result = if let Some(ref dispatcher) = self.dispatcher {
                            let (agent_name, action) = parse_tool_name(&tc.name);
                            match dispatcher(&agent_name, &action, tc.arguments.clone()).await {
                                Ok(val) => val,
                                Err(e) => serde_json::json!({"error": e.to_string()})
                            }
                        } else {
                            serde_json::json!({"status": "ok", "note": "no dispatcher"})
                        };

                        let tool_result = ToolResult {
                            tool_call_id: tc.id.clone(),
                            name: tc.name.clone(),
                            result: result.clone(),
                        };
                        let _ = tx.send(AgentLoopEvent::ToolResult { result: tool_result }).await;

                        let result_str = serde_json::to_string(&result).unwrap_or_default();
                        full_messages.push(LlmMessage {
                            role: "tool".into(),
                            content: Some(result_str),
                            tool_calls: None,
                            tool_call_id: Some(tc.id.clone()),
                            name: Some(tc.name.clone()),
                        });
                    }
                }
            }
        }

        let _ = tx.send(AgentLoopEvent::Done { usage: None }).await;
        Ok(())
    }

    /// Call LLM (DeepSeek/OpenAI compatible) with function calling
    async fn call_llm(
        &self,
        messages: &[LlmMessage],
        tools: &[ToolDefinition],
    ) -> Result<LlmResponse> {
        // Convert our LlmMessage → OpenAI message format
        let openai_msgs: Vec<serde_json::Value> = messages
            .iter()
            .map(|m| {
                let mut msg = serde_json::json!({"role": m.role});
                if let Some(c) = &m.content {
                    msg["content"] = serde_json::json!(c);
                }
                if let Some(tcs) = &m.tool_calls {
                    let calls: Vec<serde_json::Value> = tcs.iter().map(|tc| {
                        serde_json::json!({
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.name,
                                "arguments": serde_json::to_string(&tc.arguments).unwrap_or_default()
                            }
                        })
                    }).collect();
                    msg["tool_calls"] = serde_json::json!(calls);
                }
                if let Some(tcid) = &m.tool_call_id {
                    msg["tool_call_id"] = serde_json::json!(tcid);
                }
                msg
            })
            .collect();

        // Convert our ToolDefinition → OpenAI tools format
        let openai_tools: Vec<serde_json::Value> = tools
            .iter()
            .map(|t| {
                serde_json::json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters
                    }
                })
            })
            .collect();

        let mut body = serde_json::json!({
            "model": self.config.model,
            "messages": openai_msgs,
            "temperature": self.config.temperature,
            "max_tokens": self.config.max_tokens,
        });

        if !openai_tools.is_empty() {
            body["tools"] = serde_json::json!(openai_tools);
            body["tool_choice"] = serde_json::json!("auto");
        }

        info!("Calling LLM: {} messages, {} tools", messages.len(), tools.len());

        let resp = self.client
            .post(&self.config.api_url)
            .header("Authorization", format!("Bearer {}", self.config.api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| SeeHtmlError::AiApiError(e.to_string()))?;

        let status = resp.status();
        let body_text = resp
            .text()
            .await
            .map_err(|e| SeeHtmlError::AiApiError(e.to_string()))?;

        if !status.is_success() {
            return Err(SeeHtmlError::AiApiError(format!(
                "LLM API returned {}: {}",
                status,
                body_text
            )));
        }

        let json: serde_json::Value = serde_json::from_str(&body_text)
            .map_err(|e| SeeHtmlError::AiApiError(format!("Invalid LLM JSON: {}", e)))?;

        let choice = json["choices"]
            .as_array()
            .and_then(|choices| choices.first())
            .ok_or_else(|| SeeHtmlError::AiApiError(format!("LLM response missing choices: {}", json)))?;
        let message = choice
            .get("message")
            .ok_or_else(|| SeeHtmlError::AiApiError(format!("LLM response missing message: {}", json)))?;

        // Check for tool_calls in LLM response
        if let Some(tool_calls) = message.get("tool_calls") {
            let calls: Vec<ToolCall> = tool_calls
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .filter_map(|tc| {
                    let func = &tc["function"];
                    let args_str = func["arguments"].as_str().unwrap_or("{}");
                    let args: serde_json::Value =
                        serde_json::from_str(args_str).unwrap_or(serde_json::json!({}));
                    Some(ToolCall {
                        id: tc["id"].as_str().unwrap_or("").to_string(),
                        name: func["name"].as_str().unwrap_or("").to_string(),
                        arguments: args,
                    })
                })
                .collect();

            if !calls.is_empty() {
                return Ok(LlmResponse::ToolCalls(calls));
            }
        }

        let content = message["content"].as_str().unwrap_or("").to_string();
        Ok(LlmResponse::Text(content))
    }
}

enum LlmResponse {
    Text(String),
    ToolCalls(Vec<ToolCall>),
}

/// Build JSON Schema (OpenAI style) from CapabilityParameter list
/// Handles special types like "object" for theme with proper sub-schemas
fn build_json_schema(params: &[CapabilityParameter], _agent_id: &AgentId) -> serde_json::Value {
    let mut properties = serde_json::Map::new();
    let mut required: Vec<serde_json::Value> = Vec::new();

    for p in params {
        let prop_schema = match p.param_type.as_str() {
            "string" => serde_json::json!({"type": "string", "description": p.description}),
            "number" | "integer" => serde_json::json!({"type": "number", "description": p.description}),
            "boolean" => serde_json::json!({"type": "boolean", "description": p.description}),
            "object" => {
                // Provide a proper theme object schema so LLM knows the structure
                if p.name == "theme" {
                    serde_json::json!({
                        "type": "object",
                        "description": "Theme configuration for styling",
                        "properties": {
                            "name": {"type": "string", "description": "Theme name"},
                            "primary_color": {"type": "string", "description": "Primary color hex (e.g. #2563EB)"},
                            "secondary_color": {"type": "string", "description": "Secondary color hex (e.g. #22C7A9)"},
                            "accent_colors": {"type": "array", "items": {"type": "string"}, "description": "Accent color hex values"},
                            "font_family": {"type": "string", "description": "Font family name"},
                            "font_size_base": {"type": "number", "description": "Base font size in px"},
                            "dark_mode": {"type": "boolean", "description": "Enable dark mode"}
                        },
                        "required": ["name", "primary_color"]
                    })
                } else {
                    serde_json::json!({"type": "object", "description": p.description})
                }
            }
            _ => serde_json::json!({"type": "string", "description": p.description}),
        };
        properties.insert(p.name.clone(), prop_schema);

        if p.required {
            required.push(serde_json::json!(p.name));
        }
    }

    serde_json::json!({
        "type": "object",
        "properties": properties,
        "required": required,
    })
}

/// Parse "document_parse_html" or "document.parse_html" → ("DocumentAgent", "parse_html")
fn parse_tool_name(full_name: &str) -> (String, String) {
    if let Some(split_at) = full_name.find('.').or_else(|| full_name.find('_')) {
        let agent_part = &full_name[..split_at];
        let action = &full_name[split_at + 1..];
        // Map short name back to full AgentId: "document" → "DocumentAgent"
        let agent_full = match agent_part {
            "document" => "DocumentAgent",
            "content" => "ContentAgent",
            "style" => "StyleAgent",
            "media" => "MediaAgent",
            "export" => "ExportAgent",
            "publish" => "PublishAgent",
            _ => agent_part,
        };
        (agent_full.to_string(), action.to_string())
    } else {
        (full_name.to_string(), "execute".to_string())
    }
}

use crate::AgentCapability;
use crate::CapabilityParameter;
