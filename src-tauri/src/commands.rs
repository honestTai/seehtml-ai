use crate::AppState;
use seehtml_agents::{Agent, AgentContext, AgentLoop};
use seehtml_core::*;
use std::path::PathBuf;
use tauri::State;

type CmdResult<T> = std::result::Result<T, String>;

#[derive(serde::Serialize)]
pub struct FileTreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileTreeNode>>,
    pub loaded: bool,
}

fn should_skip_tree_entry(name: &str) -> bool {
    matches!(
        name,
        ".git" | ".idea" | ".vscode" | "node_modules" | "target" | "dist" | "python"
            | "SeeHTML-AI-portable" | "__pycache__"
    )
}

async fn read_directory_node(path: PathBuf) -> CmdResult<FileTreeNode> {
    let metadata = tokio::fs::metadata(&path).await.map_err(|e| e.to_string())?;
    let is_dir = metadata.is_dir();
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());

    if !is_dir {
        return Ok(FileTreeNode {
            name,
            path: path.to_string_lossy().to_string(),
            is_dir: false,
            children: None,
            loaded: true,
        });
    }

    let mut children = Vec::new();
    let mut entries = tokio::fs::read_dir(&path).await.map_err(|e| e.to_string())?;
    while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
        let child_path = entry.path();
        let child_name = entry.file_name().to_string_lossy().to_string();
        let child_meta = match entry.metadata().await {
            Ok(meta) => meta,
            Err(_) => continue,
        };

        if child_meta.is_dir() && should_skip_tree_entry(&child_name) {
            continue;
        }

        children.push(FileTreeNode {
            name: child_name,
            path: child_path.to_string_lossy().to_string(),
            is_dir: child_meta.is_dir(),
            children: if child_meta.is_dir() { None } else { Some(Vec::new()) },
            loaded: !child_meta.is_dir(),
        });
    }

    children.sort_by(|a, b| {
        let a_key = format!("{}:{}", if a.is_dir { 0 } else { 1 }, a.name.to_lowercase());
        let b_key = format!("{}:{}", if b.is_dir { 0 } else { 1 }, b.name.to_lowercase());
        a_key.cmp(&b_key)
    });

    Ok(FileTreeNode {
        name,
        path: path.to_string_lossy().to_string(),
        is_dir: true,
        children: Some(children),
        loaded: true,
    })
}

#[tauri::command]
pub async fn list_directory(path: Option<String>) -> CmdResult<FileTreeNode> {
    let root = if let Some(path) = path {
        PathBuf::from(path)
    } else {
        std::env::current_dir().map_err(|e| e.to_string())?
    };
    read_directory_node(root).await
}

#[tauri::command]
pub async fn read_text_file(path: String) -> CmdResult<String> {
    let path = PathBuf::from(path);
    let metadata = tokio::fs::metadata(&path).await.map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("Path is not a file".into());
    }
    if metadata.len() > 20 * 1024 * 1024 {
        return Err("File is too large to preview as text".into());
    }
    tokio::fs::read_to_string(&path).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_html_file(state: State<'_, AppState>, path: String) -> CmdResult<serde_json::Value> {
    let orch = state.orchestrator.lock().await;
    let ctx = AgentContext::default();
    let params = serde_json::json!({"path": path});
    let req = UserRequest {
        id: uuid::Uuid::new_v4().to_string(),
        command: "open".into(),
        parameters: params,
        context: RequestContext::default(),
    };
    let workflow = orch.plan(&req).await.map_err(|e| e.to_string())?;
    let results = orch.execute_workflow(&workflow.id, &ctx).await.map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(results).map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn get_document_info(state: State<'_, AppState>, html_content: String) -> CmdResult<serde_json::Value> {
    let _orch = state.orchestrator.lock().await;
    let ctx = AgentContext::default();
    let params = serde_json::json!({"html": html_content});
    let agent = seehtml_agents::document::DocumentAgent::new();
    let doc = agent.execute("read_html_string", params, &ctx).await.map_err(|e| e.to_string())?;
    Ok(doc)
}

#[tauri::command]
pub async fn list_agents(state: State<'_, AppState>) -> CmdResult<serde_json::Value> {
    let orch = state.orchestrator.lock().await;
    let agents = orch.list_agents().await;
    Ok(serde_json::to_value(agents).map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn execute_agent_action(
    state: State<'_, AppState>,
    _agent_id: String,
    action: String,
    params: serde_json::Value,
) -> CmdResult<serde_json::Value> {
    let orch = state.orchestrator.lock().await;
    let ctx = AgentContext::default();
    let workflow = orch.plan(&UserRequest {
        id: uuid::Uuid::new_v4().to_string(),
        command: action.clone(),
        parameters: params,
        context: RequestContext::default(),
    }).await.map_err(|e| e.to_string())?;
    let results = orch.execute_workflow(&workflow.id, &ctx).await.map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(results).map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn run_workflow(state: State<'_, AppState>, command: String, params: serde_json::Value) -> CmdResult<serde_json::Value> {
    let orch = state.orchestrator.lock().await;
    let ctx = AgentContext::default();
    let req = UserRequest {
        id: uuid::Uuid::new_v4().to_string(),
        command,
        parameters: params,
        context: RequestContext::default(),
    };
    let workflow = orch.plan(&req).await.map_err(|e| e.to_string())?;
    let results = orch.execute_workflow(&workflow.id, &ctx).await.map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(results).map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn export_document(
    _state: State<'_, AppState>,
    html: String,
    format: String,
    theme: Option<serde_json::Value>,
    output_path: Option<String>,
) -> CmdResult<serde_json::Value> {
    let theme: PresentationTheme = theme.and_then(|t| serde_json::from_value(t).ok()).unwrap_or_default();
    let title = extract_html_title(&html).unwrap_or_else(|| "document".into());
    let doc = Document {
        id: uuid::Uuid::new_v4().to_string(),
        title: title.clone(),
        source_path: None,
        html_content: html.clone(),
        metadata: DocumentMetadata::default(),
        sections: vec![DocumentSection {
            id: "s1".into(), level: 1, heading: Some(title.clone()),
            content: strip_html_tags(&html), assets: vec![], style_id: None
        }],
        assets: vec![],
        styles: vec![],
    };
    let normalized = format.to_lowercase();
    let safe_title = sanitize_file_stem(&title);
    let default_path = |ext: &str| format!("./output/{}.{}", safe_title, ext);

    let result = match normalized.as_str() {
        "pptx" => {
            let data = seehtml_export::build_pptx(&doc, &theme).map_err(|e| e.to_string())?;
            let path = output_path.clone().unwrap_or_else(|| default_path("pptx"));
            write_bytes(&path, &data).await?;
            serde_json::json!({"output_path": path, "format": "pptx"})
        }
        "markdown" | "md" => {
            let path = output_path.clone().unwrap_or_else(|| default_path("md"));
            let markdown = format!("# {}\n\n{}", doc.title, strip_html_tags(&html));
            write_text(&path, &markdown).await?;
            serde_json::json!({"output_path": path, "format": "markdown"})
        }
        "html" => {
            let path = output_path.clone().unwrap_or_else(|| default_path("html"));
            write_text(&path, &html).await?;
            serde_json::json!({"output_path": path, "format": "html"})
        }
        other => return Err(format!("Unsupported export format: {}", other)),
    };
    Ok(result)
}

async fn write_bytes(path: &str, data: &[u8]) -> CmdResult<()> {
    let pb = std::path::PathBuf::from(path);
    if let Some(parent) = pb.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
    }
    tokio::fs::write(pb, data).await.map_err(|e| e.to_string())
}

async fn write_text(path: &str, data: &str) -> CmdResult<()> {
    write_bytes(path, data.as_bytes()).await
}

fn extract_html_title(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let start = lower.find("<title>")?;
    let content_start = start + "<title>".len();
    let end = lower[content_start..].find("</title>")?;
    let title = html[content_start..content_start + end].trim();
    if title.is_empty() { None } else { Some(title.into()) }
}

fn strip_html_tags(html: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn sanitize_file_stem(input: &str) -> String {
    let mut stem: String = input
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' { ch } else { '_' })
        .collect();
    stem.truncate(80);
    if stem.trim_matches('_').is_empty() { "document".into() } else { stem }
}

#[tauri::command]
pub async fn update_ai_config(state: State<'_, AppState>, api_key: String, model: Option<String>) -> CmdResult<()> {
    let _orch = state.orchestrator.lock().await;
    let _ = (api_key, model);
    Ok(())
}

#[tauri::command]
pub async fn get_agent_status(state: State<'_, AppState>) -> CmdResult<serde_json::Value> {
    let orch = state.orchestrator.lock().await;
    let agents = orch.list_agents().await;
    Ok(serde_json::to_value(agents).map_err(|e| e.to_string())?)
}

/// LLM-based agent chat with tool calling (Claude Code / Codex style)
#[tauri::command]
pub async fn agent_chat(
    state: State<'_, AppState>,
    messages: serde_json::Value,
    tools: Option<serde_json::Value>,
    system_prompt: Option<String>,
    max_iterations: Option<u32>,
) -> CmdResult<serde_json::Value> {
    let agent_loop = &state.agent_loop;
    let msgs: Vec<LlmMessage> = serde_json::from_value(messages).map_err(|e| e.to_string())?;

    let tool_defs = if let Some(t) = tools {
        serde_json::from_value(t).map_err(|e| e.to_string())?
    } else {
        // Build tools from registered agents
        let orch = state.orchestrator.lock().await;
        let agents = orch.list_agents().await;
        let mut agent_caps: std::collections::HashMap<AgentId, Vec<seehtml_agents::AgentCapability>> = std::collections::HashMap::new();
        for a in &agents {
            let caps: Vec<seehtml_agents::AgentCapability> = a.capabilities.iter().map(|c| {
                seehtml_agents::AgentCapability {
                    action: c.action.clone(),
                    description: c.description.clone(),
                    parameters: c.parameters.clone(),
                }
            }).collect();
            agent_caps.insert(a.id.clone(), caps);
        }
        AgentLoop::build_tools(&agent_caps)
    };

    let request = AgentLoopRequest {
        messages: msgs,
        tools: tool_defs,
        system_prompt: system_prompt.or_else(|| Some(
            "You are SeeHTML AI, a marketing page creation assistant. \
             You can open HTML files, generate marketing page content, apply themes, \
             export to PPTX/Markdown/Video, process media, and OCR. \
             Use the available tools to help the user. \
             Respond in Chinese if the user writes in Chinese.".into()
        )),
        max_iterations: max_iterations.unwrap_or(10),
    };

    let result = agent_loop.chat(request).await.map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(result).map_err(|e| e.to_string())?)
}

/// Get all available tool definitions (for client-side tool display)
#[tauri::command]
pub async fn get_tools(state: State<'_, AppState>) -> CmdResult<serde_json::Value> {
    let orch = state.orchestrator.lock().await;
    let agents = orch.list_agents().await;

    let mut agent_caps: std::collections::HashMap<AgentId, Vec<seehtml_agents::AgentCapability>> = std::collections::HashMap::new();
    for a in &agents {
        let caps: Vec<seehtml_agents::AgentCapability> = a.capabilities.iter().map(|c| {
            seehtml_agents::AgentCapability {
                action: c.action.clone(),
                description: c.description.clone(),
                parameters: c.parameters.clone(),
            }
        }).collect();
        agent_caps.insert(a.id.clone(), caps);
    }

    let tools = AgentLoop::build_tools(&agent_caps);
    Ok(serde_json::to_value(tools).map_err(|e| e.to_string())?)
}

/// Save captured PNG image to disk
#[tauri::command]
pub async fn save_image(_state: State<'_, AppState>, data_url: String, index: Option<u32>) -> CmdResult<String> {
    // Parse data URL: "data:image/png;base64,xxxxx"
    let b64 = if let Some(comma) = data_url.find(',') {
        data_url[comma + 1..].to_string()
    } else {
        data_url
    };

    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&b64)
        .map_err(|e| e.to_string())?;

    let idx = index.unwrap_or(0);
    let path = std::path::PathBuf::from(format!("./output/slide_{}.png", idx));
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
    }
    tokio::fs::write(&path, &bytes).await.map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Resolve bundled resource path (production next to exe, dev from project root)
fn resource_path(relative: &str) -> std::path::PathBuf {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_default();

    // Production: resources extracted next to exe
    let prod = exe_dir.join(relative);
    if prod.exists() { return prod; }

    // Try _up from exe (Tauri v2 extracts resources)
    for up in 0..4 {
        let mut p = exe_dir.clone();
        for _ in 0..up { p = p.join(".."); }
        let candidate = p.join(relative);
        if candidate.exists() { return candidate; }
    }

    // Dev fallback: project root
    let dev = std::path::PathBuf::from(relative);
    if dev.exists() { return dev; }

    // Return prod path anyway (caller handles missing)
    prod
}

/// Run OCR on an image using bundled Python
#[tauri::command]
pub async fn run_ocr(_state: State<'_, AppState>, image_path: String, engine: Option<String>) -> CmdResult<serde_json::Value> {
    let engine = engine.unwrap_or_else(|| "easyocr".into()); // Default easyocr = no Tesseract needed
    let python_exe = resource_path("python/python.exe");
    let python_script = resource_path("python/ocr_service.py");

    let py_cmd = if python_exe.exists() { python_exe.to_string_lossy().to_string() } else { "python".into() };
    let script = if python_script.exists() { python_script.to_string_lossy().to_string() } else { "./python/ocr_service.py".into() };

    let output = tokio::process::Command::new(&py_cmd)
        .arg(&script)
        .arg(&image_path)
        .arg("--engine").arg(&engine)
        .arg("--lang").arg("chi_sim+eng")
        .output().await
        .map_err(|e| format!("OCR failed - ensure Python is installed: {}", e))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(serde_json::from_str(&stdout).unwrap_or(serde_json::json!({"text": stdout})))
    } else {
        Err(format!("OCR error: {}", String::from_utf8_lossy(&output.stderr)))
    }
}

/// Generate video from slide images using bundled ffmpeg
#[tauri::command]
pub async fn generate_video(_state: State<'_, AppState>, _slide_count: u32, output_path: Option<String>) -> CmdResult<String> {
    let out = output_path.unwrap_or_else(|| "./output/presentation.mp4".into());
    let out_path = std::path::PathBuf::from(&out);
    if let Some(parent) = out_path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
    }

    let ffmpeg = resource_path("ffmpeg/ffmpeg.exe");
    let ffmpeg_cmd = if ffmpeg.exists() { ffmpeg.to_string_lossy().to_string() } else { "ffmpeg".into() };

    let status = tokio::process::Command::new(&ffmpeg_cmd)
        .args(["-y", "-framerate", "1/3", "-i", "./output/slide_%d.png",
               "-c:v", "libx264", "-r", "30", "-pix_fmt", "yuv420p",
               "-vf", "scale=1920:1080", &out])
        .status().await
        .map_err(|e| format!("ffmpeg error: {}", e))?;

    if status.success() { Ok(out) }
    else { Err("ffmpeg failed. Ensure slide images exist in ./output/".into()) }
}

/// Save document as HTML file
#[tauri::command]
pub async fn save_html(_state: State<'_, AppState>, html: String, path: Option<String>) -> CmdResult<String> {
    let p = path.unwrap_or_else(|| "./output/document.html".into());
    let pb = std::path::PathBuf::from(&p);
    if let Some(parent) = pb.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
    }
    tokio::fs::write(&pb, &html).await.map_err(|e| e.to_string())?;
    Ok(p)
}

/// Get conversation memory (simple key-value store)
#[tauri::command]
pub async fn get_memory(state: State<'_, AppState>, key: String) -> CmdResult<Option<String>> {
    let orch = state.orchestrator.lock().await;
    let cache = orch.results_cache.read().await;
    Ok(cache.get(&key).and_then(|v| v.as_str().map(|s| s.to_string())))
}

/// Set conversation memory
#[tauri::command]
pub async fn set_memory(state: State<'_, AppState>, key: String, value: String) -> CmdResult<()> {
    let orch = state.orchestrator.lock().await;
    orch.results_cache.write().await.insert(key, serde_json::json!(value));
    Ok(())
}
