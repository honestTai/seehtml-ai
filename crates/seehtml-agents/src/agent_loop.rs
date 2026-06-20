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
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tracing::info;
use tokio::sync::mpsc;

/// Callback type for executing a tool. Returns the tool result as JSON.
pub type ToolDispatcher = Arc<
    dyn Fn(&str, &str, serde_json::Value, AgentRuntimeContext) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<serde_json::Value>> + Send>>
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

    /// FlowMark-style mode: plan first, then execute with a constrained tool set.
    pub async fn chat_planned(
        &self,
        mut request: AgentLoopRequest,
    ) -> Result<PlannedAgentLoopResponse> {
        let plan = self.plan_request(&request).await?;

        if plan.needs_clarification {
            let messages = self.clarification_messages(request, &plan);
            return Ok(PlannedAgentLoopResponse { messages, plan });
        }

        request.tools = planned_tools(&request.tools, &plan);
        let base_prompt = request.system_prompt.take();
        request.system_prompt = Some(system_prompt_with_plan(base_prompt, &plan));
        let messages = self.chat(request).await?;
        Ok(PlannedAgentLoopResponse { messages, plan })
    }

    async fn plan_request(&self, request: &AgentLoopRequest) -> Result<AgentExecutionPlan> {
        let messages = vec![
            LlmMessage {
                role: "system".into(),
                content: Some(planner_system_prompt()),
                tool_calls: None,
                tool_call_id: None,
                name: None,
            },
            LlmMessage {
                role: "user".into(),
                content: Some(planner_user_prompt(request)),
                tool_calls: None,
                tool_call_id: None,
                name: None,
            },
        ];

        match self.call_llm(&messages, &[]).await? {
            LlmResponse::Text(text) => {
                let mut plan = parse_plan(&text, &request.tools)?;
                enforce_plan_context(&mut plan, request);
                Ok(plan)
            }
            LlmResponse::ToolCalls(_) => Err(SeeHtmlError::AiApiError(
                "Agent planner tried to call tools instead of returning a plan.".into(),
            )),
        }
    }

    fn clarification_messages(
        &self,
        mut request: AgentLoopRequest,
        plan: &AgentExecutionPlan,
    ) -> Vec<LlmMessage> {
        let base_prompt = request.system_prompt.take();
        let mut full_messages = vec![LlmMessage {
            role: "system".into(),
            content: Some(system_prompt_with_plan(base_prompt, plan)),
            tool_calls: None,
            tool_call_id: None,
            name: None,
        }];
        full_messages.append(&mut request.messages);
        full_messages.push(LlmMessage {
            role: "assistant".into(),
            content: Some(clarification_text(plan)),
            tool_calls: None,
            tool_call_id: None,
            name: None,
        });
        full_messages
    }

    /// Batch mode: run agent loop, execute tools via dispatcher
    pub async fn chat(
        &self,
        request: AgentLoopRequest,
    ) -> Result<Vec<LlmMessage>> {
        let mut messages = request.messages;
        let tools = request.tools;
        let mut runtime_context = request.runtime_context;
        let max_iter = request.max_iterations.max(1).min(20);

        let system_msg = LlmMessage {
            role: "system".into(),
            content: request.system_prompt.clone(),
            tool_calls: None, tool_call_id: None, name: None,
        };

        let mut full_messages = vec![system_msg];
        full_messages.append(&mut messages);

        for _i in 0..max_iter {
            let response = self.call_llm(&full_messages, &tools).await?;

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
                            match dispatcher(&agent_name, &action, tc.arguments.clone(), runtime_context.clone()).await {
                                Ok(val) => val,
                                Err(e) => serde_json::json!({"error": e.to_string()})
                            }
                        } else {
                            serde_json::json!({"status": "ok", "note": "no dispatcher configured"})
                        };
                        remember_tool_result(&mut runtime_context, tc, &result);

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
        let tools = request.tools;
        let mut runtime_context = request.runtime_context;
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

            let response = self.call_llm(&full_messages, &tools).await?;

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
                            match dispatcher(&agent_name, &action, tc.arguments.clone(), runtime_context.clone()).await {
                                Ok(val) => val,
                                Err(e) => serde_json::json!({"error": e.to_string()})
                            }
                        } else {
                            serde_json::json!({"status": "ok", "note": "no dispatcher"})
                        };
                        remember_tool_result(&mut runtime_context, tc, &result);

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

    /// Call an OpenAI-compatible LLM with function calling.
    async fn call_llm(
        &self,
        messages: &[LlmMessage],
        tools: &[ToolDefinition],
    ) -> Result<LlmResponse> {
        if self.config.api_key.trim().is_empty() {
            return Err(SeeHtmlError::AiApiError(
                "AI API key is not configured. Set SEEHTML_AI_API_KEY or create ai-config.json."
                    .into(),
            ));
        }

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

fn remember_tool_result(
    context: &mut AgentRuntimeContext,
    tool_call: &ToolCall,
    result: &serde_json::Value,
) {
    context
        .previous_results
        .insert(tool_call.id.clone(), result.clone());
    context.previous_results.insert(
        format!("{}:{}", tool_call.name, tool_call.id),
        result.clone(),
    );
}

fn planner_system_prompt() -> String {
    r#"You are SeeHTML AI's server-side Agent planner.
Return compact JSON only. Do not answer the user's task.
The UI intent classifier and available tools are hints, not hard boundaries.

Decide whether the user wants: clarification, normal chat, HTML creation/editing, local file work, export, publish/package, or media processing.
Normal greetings, small talk, and product questions should use no tools.
For HTML creation/editing, prefer direct final model output unless a registered tool exactly matches a required local action.
Only select tools when required inputs are present. Never select export/media tools merely because they exist.
Never select MP4/video/media work unless the user explicitly asks to render, export, generate, convert, or process video/media.
Ask a clarification only when a key decision would materially change the result. If a reasonable default is low-risk, choose it and explain the assumption in routeReason.
When clarification is needed, ask exactly one concrete question and provide 2-4 mutually exclusive, action-oriented options. Put the recommended option first when one is safest. Each option should include a short impact/tradeoff using " — ", for example "Product landing page (Recommended) — fastest path when the user has a product or offer".
Avoid generic options such as "more details" or "other"; the UI already lets the user type a custom answer.
If the request is vague, especially "make it better", "do a page", "adjust it", or unclear export/edit scope, set needsClarification=true and ask one concise question with useful options.
Under-specified HTML animation requests must ask for details before generating when the user only mentions HTML/animation/duration but omits subject, scenes, visual style, or delivery target.
For long animation requests such as "1 minute HTML animation", ask which creative route to take and offer specific options like abstract particles, product/brand intro, data visualization story, character/scene short, or looping ambient background.

JSON schema:
{
  "primaryIntent": "chat | clarify | create_html | edit_html | open_file | export | media | publish",
  "taskFocus": "short execution focus",
  "steps": ["2-5 short execution steps"],
  "allowedTools": ["exact tool names from the available tool list, or empty array"],
  "needsClarification": true,
  "clarificationQuestion": "one short question, null when not needed",
  "clarificationOptions": ["2-4 options, each as Label (Recommended when applicable) — impact/tradeoff"],
  "wantsHtmlOutput": false,
  "wantsPreviewUpdate": false,
  "wantsVideoExport": false,
  "routeReason": "short user-facing reason"
}"#
    .into()
}

fn planner_user_prompt(request: &AgentLoopRequest) -> String {
    let available_tools = if request.tools.is_empty() {
        "No registered tools are available.".to_string()
    } else {
        request
            .tools
            .iter()
            .map(|tool| format!("- {}: {}", tool.name, clip(&tool.description, 220)))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let base_system = request
        .system_prompt
        .as_deref()
        .map(|value| clip(value, 1400))
        .unwrap_or_else(|| "No base system prompt supplied.".into());
    let recent_messages = request
        .messages
        .iter()
        .rev()
        .take(8)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(|message| {
            format!(
                "{}: {}",
                message.role,
                clip(message.content.as_deref().unwrap_or(""), 1600)
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    let latest_user = request
        .messages
        .iter()
        .rev()
        .find(|message| message.role == "user")
        .and_then(|message| message.content.as_deref())
        .map(|value| clip(value, 5000))
        .unwrap_or_default();
    let runtime_context = runtime_context_summary(&request.runtime_context);

    format!(
        r#"Base system boundary:
{base_system}

Runtime context:
{runtime_context}

Available tools:
{available_tools}

Recent conversation:
{recent_messages}

Latest user request:
{latest_user}"#
    )
}

fn runtime_context_summary(context: &AgentRuntimeContext) -> String {
    let document = context
        .current_document
        .as_ref()
        .map(|doc| {
            format!(
                "loaded title=\"{}\", html_chars={}, sections={}",
                clip(&doc.title, 120),
                doc.html_content.chars().count(),
                doc.sections.len()
            )
        })
        .unwrap_or_else(|| "none".into());
    let project_dir = context
        .project_dir
        .as_ref()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| "none".into());
    let current_file = context
        .current_file
        .as_ref()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| "none".into());
    let memories = if context.memory_snippets.is_empty() {
        "none".into()
    } else {
        context
            .memory_snippets
            .iter()
            .take(8)
            .map(|item| format!("- {}: {}", item.key, clip(&item.value, 240)))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let previous_results = if context.previous_results.is_empty() {
        "none".into()
    } else {
        context
            .previous_results
            .keys()
            .take(12)
            .cloned()
            .collect::<Vec<_>>()
            .join(", ")
    };

    format!(
        r#"sessionId={session_id}
projectDir={project_dir}
currentFile={current_file}
currentDocument={document}
memory:
{memories}
previousResults={previous_results}"#,
        session_id = context.session_id.as_deref().unwrap_or("none"),
    )
}

fn parse_plan(content: &str, available_tools: &[ToolDefinition]) -> Result<AgentExecutionPlan> {
    let json_text = extract_json_object(content).ok_or_else(|| {
        SeeHtmlError::AiApiError("Agent planner returned an invalid plan.".into())
    })?;
    let root: serde_json::Value = serde_json::from_str(&json_text).map_err(|_| {
        SeeHtmlError::AiApiError("Agent planner returned an invalid JSON plan.".into())
    })?;

    let available_names = available_tools
        .iter()
        .map(|tool| tool.name.as_str())
        .collect::<HashSet<_>>();
    let allowed_tools = string_list(&root, &["allowedTools", "allowed_tools", "tools"])
        .into_iter()
        .filter(|name| available_names.contains(name.as_str()))
        .collect::<Vec<_>>();
    let needs_clarification = bool_field(
        &root,
        &["needsClarification", "needs_clarification"],
        false,
    );
    let clarification_question = optional_text(
        &root,
        &["clarificationQuestion", "clarification_question", "question"],
    );

    let mut plan = AgentExecutionPlan {
        primary_intent: text_field(
            &root,
            &["primaryIntent", "primary_intent", "intent"],
            "chat",
        ),
        task_focus: text_field(
            &root,
            &["taskFocus", "task_focus", "focus"],
            "Follow the user's request directly.",
        ),
        steps: string_list(&root, &["steps"]).into_iter().take(5).collect(),
        allowed_tools,
        needs_clarification,
        clarification_question,
        clarification_options: string_list(
            &root,
            &["clarificationOptions", "clarification_options", "options"],
        )
        .into_iter()
        .take(5)
        .collect(),
        wants_html_output: bool_field(&root, &["wantsHtmlOutput", "wants_html_output"], false),
        wants_preview_update: bool_field(
            &root,
            &["wantsPreviewUpdate", "wants_preview_update"],
            false,
        ),
        wants_video_export: bool_field(
            &root,
            &["wantsVideoExport", "wants_video_export"],
            false,
        ),
        route_reason: text_field(
            &root,
            &["routeReason", "route_reason", "reason"],
            "Planned by SeeHTML Agent.",
        ),
    };

    if plan.steps.is_empty() {
        plan.steps = vec!["Understand the request".into(), "Execute the selected route".into()];
    }
    if plan.needs_clarification && plan.clarification_question.is_none() {
        plan.clarification_question = Some("What should I do next?".into());
    }
    Ok(plan)
}

fn enforce_plan_context(plan: &mut AgentExecutionPlan, request: &AgentLoopRequest) {
    if plan.allowed_tools.is_empty() || request.runtime_context.current_document.is_some() {
        return;
    }

    let needs_document = plan
        .allowed_tools
        .iter()
        .any(|tool| tool_requires_current_document(tool));
    if !needs_document {
        return;
    }

    let zh = latest_user_text(request)
        .map(contains_cjk)
        .unwrap_or(false);
    plan.primary_intent = "clarify".into();
    plan.task_focus = if zh {
        "先获取当前 HTML 文档，再继续执行。".into()
    } else {
        "Get a current HTML document before continuing.".into()
    };
    plan.steps = if zh {
        vec!["确认当前页面".into(), "打开或生成 HTML 后再执行工具".into()]
    } else {
        vec![
            "Confirm the current page".into(),
            "Run the tool after an HTML document is available".into(),
        ]
    };
    plan.allowed_tools.clear();
    plan.needs_clarification = true;
    plan.clarification_question = Some(if zh {
        "请先打开或生成一个 HTML 页面，再执行这个操作。".into()
    } else {
        "Open or generate an HTML document first, then I can run this operation.".into()
    });
    plan.clarification_options = if zh {
        vec![
            "打开本地 HTML（推荐） — 基于真实页面继续，最不容易改偏".into(),
            "先生成一个 HTML — 没有现成页面时从新文档开始".into(),
        ]
    } else {
        vec![
            "Open a local HTML file (Recommended) — continue from the real page with less risk".into(),
            "Generate an HTML document first — start from a new document when none exists".into(),
        ]
    };
    plan.wants_preview_update = false;
    plan.wants_video_export = false;
    plan.route_reason = if zh {
        "所选工具需要当前 HTML 文档，但本轮上下文里还没有可用文档。".into()
    } else {
        "The selected tool needs the current HTML document, but none is available in this turn.".into()
    };
}

fn tool_requires_current_document(tool_name: &str) -> bool {
    tool_name.starts_with("style_")
        || tool_name.starts_with("export_")
        || tool_name.starts_with("publish_")
}

fn latest_user_text(request: &AgentLoopRequest) -> Option<&str> {
    request
        .messages
        .iter()
        .rev()
        .find(|message| message.role == "user")
        .and_then(|message| message.content.as_deref())
}

fn contains_cjk(value: &str) -> bool {
    value.chars().any(|ch| matches!(ch, '\u{4e00}'..='\u{9fff}'))
}

fn planned_tools(tools: &[ToolDefinition], plan: &AgentExecutionPlan) -> Vec<ToolDefinition> {
    if plan.allowed_tools.is_empty() {
        return Vec::new();
    }
    let allowed = plan
        .allowed_tools
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    tools
        .iter()
        .filter(|tool| allowed.contains(tool.name.as_str()))
        .cloned()
        .collect()
}

fn system_prompt_with_plan(base: Option<String>, plan: &AgentExecutionPlan) -> String {
    let base = base.unwrap_or_else(|| {
        "You are SeeHTML AI. Respond in the same language as the user.".into()
    });
    format!(
        r#"{base}

Server planner:
primaryIntent={primary_intent}
taskFocus={task_focus}
steps={steps}
allowedTools={allowed_tools}
needsClarification={needs_clarification}
wantsHtmlOutput={wants_html_output}
wantsPreviewUpdate={wants_preview_update}
wantsVideoExport={wants_video_export}
routeReason={route_reason}

Planner boundary:
- Treat the plan as guidance for this turn.
- If allowedTools is empty, answer directly and do not pretend tools were used.
- If the plan requests HTML output, return one complete previewable <!DOCTYPE html> document unless the user asked only for advice.
- Do not create, render, or export MP4/video unless wantsVideoExport=true."#,
        primary_intent = &plan.primary_intent,
        task_focus = &plan.task_focus,
        steps = plan.steps.join(" | "),
        allowed_tools = if plan.allowed_tools.is_empty() {
            "none".into()
        } else {
            plan.allowed_tools.join(", ")
        },
        needs_clarification = plan.needs_clarification,
        wants_html_output = plan.wants_html_output,
        wants_preview_update = plan.wants_preview_update,
        wants_video_export = plan.wants_video_export,
        route_reason = &plan.route_reason,
    )
}

fn clarification_text(plan: &AgentExecutionPlan) -> String {
    let question = plan
        .clarification_question
        .as_deref()
        .unwrap_or("What should I do next?");
    if plan.clarification_options.is_empty() {
        return question.to_string();
    }
    let options = plan
        .clarification_options
        .iter()
        .enumerate()
        .map(|(index, option)| format!("{}. {}", index + 1, option))
        .collect::<Vec<_>>()
        .join("\n");
    format!("{question}\n{options}")
}

fn extract_json_object(content: &str) -> Option<String> {
    let trimmed = content.trim();
    let without_fence = if trimmed.starts_with("```") {
        let first_newline = trimmed.find('\n')?;
        let last_fence = trimmed.rfind("```")?;
        if last_fence <= first_newline {
            trimmed
        } else {
            trimmed[first_newline + 1..last_fence].trim()
        }
    } else {
        trimmed
    };
    let start = without_fence.find('{')?;
    let end = without_fence.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(without_fence[start..=end].to_string())
}

fn text_field(root: &serde_json::Value, keys: &[&str], fallback: &str) -> String {
    optional_text(root, keys).unwrap_or_else(|| fallback.into())
}

fn optional_text(root: &serde_json::Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(value) = root.get(*key).and_then(|value| value.as_str()) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn bool_field(root: &serde_json::Value, keys: &[&str], fallback: bool) -> bool {
    for key in keys {
        if let Some(value) = root.get(*key).and_then(|value| value.as_bool()) {
            return value;
        }
    }
    fallback
}

fn string_list(root: &serde_json::Value, keys: &[&str]) -> Vec<String> {
    for key in keys {
        if let Some(values) = root.get(*key).and_then(|value| value.as_array()) {
            return values
                .iter()
                .filter_map(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect();
        }
    }
    Vec::new()
}

fn clip(value: &str, limit: usize) -> String {
    if value.chars().count() <= limit {
        return value.to_string();
    }
    let clipped = value.chars().take(limit).collect::<String>();
    format!("{clipped}\n... [truncated]")
}

use crate::AgentCapability;
use crate::CapabilityParameter;
