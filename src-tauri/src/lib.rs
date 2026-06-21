use seehtml_agents::AgentContext;
use seehtml_agents::AgentLoop;
use seehtml_agents::Orchestrator;
use seehtml_agents::agent_loop::ToolDispatcher;
use seehtml_agents::content::ContentAgent;
use seehtml_agents::document::DocumentAgent;
use seehtml_agents::export_agent::ExportAgent;
use seehtml_core::*;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing_subscriber;

pub mod commands;

/// Application state shared across all Tauri commands
pub struct AppState {
    pub orchestrator: Arc<Mutex<Orchestrator>>,
    pub agent_loop: Arc<Mutex<AgentLoop>>,
    pub ai_config: Arc<Mutex<AiConfig>>,
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
    let ai_config_state = Arc::new(Mutex::new(ai_config.clone()));

    let mut orchestrator = Orchestrator::new();
    // Open-source core: file parsing, HTML generation, and PPT export.
    // MP4 rendering is handled by the preview pipeline + FFmpeg command.
    orchestrator.register(Arc::new(DocumentAgent::new()));
    orchestrator.register(Arc::new(ContentAgent::new(ai_config.clone())));
    orchestrator.register(Arc::new(ExportAgent::new()));

    let orchestrator = Arc::new(Mutex::new(orchestrator));
    let orch_for_dispatcher = orchestrator.clone();
    let ai_config_for_dispatcher = ai_config_state.clone();

    // Create dispatcher that connects AgentLoop to Orchestrator
    // When LLM calls a tool, this dispatcher executes it via the real agents
    let dispatcher: ToolDispatcher = Arc::new(
        move |agent_name: &str,
              action: &str,
              params: serde_json::Value,
              runtime_context: AgentRuntimeContext| {
            let orch = orch_for_dispatcher.clone();
            let ai_config_state = ai_config_for_dispatcher.clone();
            let agent_name = agent_name.to_string();
            let action = action.to_string();
            Box::pin(async move {
                let orch = orch.lock().await;
                let ai_config = ai_config_state.lock().await.clone();
                let agent_id =
                    agent_id_from_name(&agent_name).ok_or_else(|| SeeHtmlError::AgentError {
                        agent: agent_name.clone(),
                        message: "Unknown agent".into(),
                    })?;
                let mut context = AgentContext::from(runtime_context);
                context.config = Some(ai_config);
                orch.dispatch(&agent_id, &action, &params, &context).await
            })
        },
    );

    let agent_loop = Arc::new(Mutex::new(
        AgentLoop::new(ai_config.clone()).with_dispatcher(dispatcher),
    ));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            orchestrator: orchestrator.clone(),
            agent_loop: agent_loop.clone(),
            ai_config: ai_config_state,
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
            commands::get_ai_config,
            commands::update_ai_config,
            commands::get_agent_status,
            commands::agent_chat,
            commands::agent_chat_stream,
            commands::get_tools,
            commands::save_image,
            commands::prepare_image_assets,
            commands::clear_rendered_frames,
            commands::run_ocr,
            commands::generate_video,
            commands::save_html,
            commands::get_memory,
            commands::set_memory,
            commands::list_memory,
            commands::search_memory,
            commands::refresh_context_index,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[derive(serde::Deserialize)]
struct PartialAiConfig {
    provider: Option<String>,
    api_url: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    use_auth_header: Option<bool>,
    supports_vision: Option<bool>,
    use_default_ocr: Option<bool>,
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
    if let Ok(provider) = std::env::var("SEEHTML_AI_PROVIDER") {
        if !provider.trim().is_empty() {
            config.provider = provider;
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
    if let Ok(use_auth_header) = std::env::var("SEEHTML_AI_USE_AUTH_HEADER") {
        if let Ok(value) = use_auth_header.parse::<bool>() {
            config.use_auth_header = value;
        }
    }
    if let Ok(supports_vision) = std::env::var("SEEHTML_AI_SUPPORTS_VISION") {
        if let Ok(value) = supports_vision.parse::<bool>() {
            config.supports_vision = value;
        }
    }
    if let Ok(use_default_ocr) = std::env::var("SEEHTML_AI_USE_DEFAULT_OCR") {
        if let Ok(value) = use_default_ocr.parse::<bool>() {
            config.use_default_ocr = value;
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
    if let Some(provider) = partial.provider.filter(|value| !value.trim().is_empty()) {
        config.provider = provider;
    }
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
    if let Some(use_auth_header) = partial.use_auth_header {
        config.use_auth_header = use_auth_header;
    }
    if let Some(supports_vision) = partial.supports_vision {
        config.supports_vision = supports_vision;
    }
    if let Some(use_default_ocr) = partial.use_default_ocr {
        config.use_default_ocr = use_default_ocr;
    }
}
