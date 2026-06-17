use seehtml_agents::AgentContext;
use seehtml_agents::AgentLoop;
use seehtml_agents::Orchestrator;
use seehtml_agents::agent_loop::ToolDispatcher;
use seehtml_agents::content::ContentAgent;
use seehtml_agents::document::DocumentAgent;
use seehtml_agents::export_agent::ExportAgent;
use seehtml_agents::media::MediaAgent;
use seehtml_agents::publish::PublishAgent;
use seehtml_agents::style::StyleAgent;
use seehtml_core::*;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing_subscriber;

pub mod commands;

/// Application state shared across all Tauri commands
pub struct AppState {
    pub orchestrator: Arc<Mutex<Orchestrator>>,
    pub agent_loop: Arc<AgentLoop>,
    pub ai_config: AiConfig,
}

/// Map agent short name → AgentId for dispatch
fn agent_id_from_name(name: &str) -> Option<AgentId> {
    match name.to_lowercase().as_str() {
        "documentagent" | "document" => Some(AgentId::Document),
        "contentagent" | "content" => Some(AgentId::Content),
        "styleagent" | "style" => Some(AgentId::Style),
        "mediaagent" | "media" => Some(AgentId::Media),
        "exportagent" | "export" => Some(AgentId::Export),
        "publishagent" | "publish" => Some(AgentId::Publish),
        _ => None,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();

    let ai_config = load_ai_config();

    let mut orchestrator = Orchestrator::new();
    // Register all agents
    orchestrator.register(Arc::new(DocumentAgent::new()));
    orchestrator.register(Arc::new(ContentAgent::new(ai_config.clone())));
    orchestrator.register(Arc::new(StyleAgent::new()));
    orchestrator.register(Arc::new(MediaAgent::new(None)));
    orchestrator.register(Arc::new(ExportAgent::new()));
    orchestrator.register(Arc::new(PublishAgent::new()));

    let orchestrator = Arc::new(Mutex::new(orchestrator));
    let orch_for_dispatcher = orchestrator.clone();

    // Create dispatcher that connects AgentLoop to Orchestrator
    // When LLM calls a tool, this dispatcher executes it via the real agents
    let dispatcher: ToolDispatcher = Arc::new(
        move |agent_name: &str, action: &str, params: serde_json::Value| {
            let orch = orch_for_dispatcher.clone();
            let agent_name = agent_name.to_string();
            let action = action.to_string();
            Box::pin(async move {
                let orch = orch.lock().await;
                let agent_id =
                    agent_id_from_name(&agent_name).ok_or_else(|| SeeHtmlError::AgentError {
                        agent: agent_name.clone(),
                        message: "Unknown agent".into(),
                    })?;
                let context = AgentContext::default();
                orch.dispatch(&agent_id, &action, &params, &context).await
            })
        },
    );

    let agent_loop = Arc::new(AgentLoop::new(ai_config.clone()).with_dispatcher(dispatcher));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            orchestrator: orchestrator.clone(),
            agent_loop: agent_loop.clone(),
            ai_config,
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_html_file,
            commands::list_directory,
            commands::create_project_directory,
            commands::find_project_entry,
            commands::read_text_file,
            commands::read_binary_preview,
            commands::get_document_info,
            commands::list_agents,
            commands::execute_agent_action,
            commands::run_workflow,
            commands::export_document,
            commands::update_ai_config,
            commands::get_agent_status,
            commands::agent_chat,
            commands::get_tools,
            commands::save_image,
            commands::clear_rendered_frames,
            commands::run_ocr,
            commands::generate_video,
            commands::save_html,
            commands::get_memory,
            commands::set_memory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[derive(serde::Deserialize)]
struct PartialAiConfig {
    api_url: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
}

fn load_ai_config() -> AiConfig {
    let mut config = AiConfig::default();

    if let Some(file_config) = read_ai_config_file() {
        apply_partial_ai_config(&mut config, file_config);
    }

    if let Ok(api_url) = std::env::var("SEEHTML_AI_API_URL") {
        if !api_url.trim().is_empty() {
            config.api_url = api_url;
        }
    }
    if let Ok(api_key) = std::env::var("SEEHTML_AI_API_KEY") {
        if !api_key.trim().is_empty() {
            config.api_key = api_key;
        }
    }
    if let Ok(model) = std::env::var("SEEHTML_AI_MODEL") {
        if !model.trim().is_empty() {
            config.model = model;
        }
    }

    config
}

fn read_ai_config_file() -> Option<PartialAiConfig> {
    let path = ai_config_path()?;
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

fn ai_config_path() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("SEEHTML_AI_CONFIG") {
        if !path.trim().is_empty() {
            return Some(PathBuf::from(path));
        }
    }

    std::env::var("APPDATA")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .map(|dir| dir.join("SeeHTML AI").join("ai-config.json"))
}

fn apply_partial_ai_config(config: &mut AiConfig, partial: PartialAiConfig) {
    if let Some(api_url) = partial.api_url.filter(|value| !value.trim().is_empty()) {
        config.api_url = api_url;
    }
    if let Some(api_key) = partial.api_key.filter(|value| !value.trim().is_empty()) {
        config.api_key = api_key;
    }
    if let Some(model) = partial.model.filter(|value| !value.trim().is_empty()) {
        config.model = model;
    }
    if let Some(temperature) = partial.temperature {
        config.temperature = temperature;
    }
    if let Some(max_tokens) = partial.max_tokens {
        config.max_tokens = max_tokens;
    }
}
