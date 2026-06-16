use seehtml_agents::Orchestrator;
use seehtml_agents::AgentLoop;
use seehtml_agents::agent_loop::ToolDispatcher;
use seehtml_agents::document::DocumentAgent;
use seehtml_agents::content::ContentAgent;
use seehtml_agents::style::StyleAgent;
use seehtml_agents::media::MediaAgent;
use seehtml_agents::export_agent::ExportAgent;
use seehtml_agents::publish::PublishAgent;
use seehtml_agents::AgentContext;
use seehtml_core::*;
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

    let ai_config = AiConfig::default();

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
    let dispatcher: ToolDispatcher = Arc::new(move |agent_name: &str, action: &str, params: serde_json::Value| {
        let orch = orch_for_dispatcher.clone();
        let agent_name = agent_name.to_string();
        let action = action.to_string();
        Box::pin(async move {
            let orch = orch.lock().await;
            let agent_id = agent_id_from_name(&agent_name)
                .ok_or_else(|| SeeHtmlError::AgentError {
                    agent: agent_name.clone(),
                    message: "Unknown agent".into()
                })?;
            let context = AgentContext::default();
            orch.dispatch(&agent_id, &action, &params, &context).await
        })
    });

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
            commands::read_text_file,
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
            commands::run_ocr,
            commands::generate_video,
            commands::save_html,
            commands::get_memory,
            commands::set_memory,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
