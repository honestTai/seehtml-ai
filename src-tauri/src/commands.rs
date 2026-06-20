use crate::AppState;
use rusqlite::{Connection, OptionalExtension, params};
use seehtml_agents::{Agent, AgentContext, AgentLoop};
use seehtml_core::*;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
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

#[derive(serde::Serialize)]
pub struct BinaryPreview {
    pub name: String,
    pub mime: String,
    pub data_url: String,
    pub size: u64,
}

#[derive(serde::Serialize)]
pub struct MemoryRecord {
    pub key: String,
    pub value: String,
    pub kind: String,
    pub source: Option<String>,
    pub updated_at: String,
}

fn should_skip_tree_entry(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | ".seehtml"
            | ".idea"
            | ".vscode"
            | "node_modules"
            | "target"
            | "dist"
            | "output"
            | "python"
            | "ffmpeg"
            | "SeeHTML-AI-portable"
            | "__pycache__"
    )
}

async fn read_directory_node(path: PathBuf) -> CmdResult<FileTreeNode> {
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|e| e.to_string())?;
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
    let mut entries = tokio::fs::read_dir(&path)
        .await
        .map_err(|e| e.to_string())?;
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
            children: if child_meta.is_dir() {
                None
            } else {
                Some(Vec::new())
            },
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
    let Some(path) = path else {
        return Err("No project selected".into());
    };
    read_directory_node(PathBuf::from(path)).await
}

#[tauri::command]
pub async fn create_project_directory(
    parent_path: String,
    name: Option<String>,
) -> CmdResult<String> {
    let parent = PathBuf::from(parent_path);
    let metadata = tokio::fs::metadata(&parent)
        .await
        .map_err(|e| e.to_string())?;
    if !metadata.is_dir() {
        return Err("Parent path is not a directory".into());
    }

    let base_name = name
        .as_deref()
        .map(sanitize_file_stem)
        .filter(|value| !value.trim_matches('_').is_empty())
        .unwrap_or_else(|| {
            format!(
                "seehtml-project-{}",
                chrono::Local::now().format("%Y%m%d-%H%M%S")
            )
        });

    let mut candidate = parent.join(&base_name);
    let mut suffix = 2usize;
    while tokio::fs::try_exists(&candidate)
        .await
        .map_err(|e| e.to_string())?
    {
        candidate = parent.join(format!("{}-{}", base_name, suffix));
        suffix += 1;
    }

    tokio::fs::create_dir_all(&candidate)
        .await
        .map_err(|e| e.to_string())?;
    Ok(candidate.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn find_project_entry(path: String) -> CmdResult<Option<String>> {
    let root = PathBuf::from(path);
    let metadata = tokio::fs::metadata(&root)
        .await
        .map_err(|e| e.to_string())?;
    if !metadata.is_dir() {
        return Ok(if is_html_file(&root) {
            Some(root.to_string_lossy().to_string())
        } else {
            None
        });
    }

    let mut stack = vec![(root.clone(), 0usize)];
    let mut matches: Vec<(usize, String)> = Vec::new();

    while let Some((dir, depth)) = stack.pop() {
        if depth > 5 {
            continue;
        }

        let mut entries = match tokio::fs::read_dir(&dir).await {
            Ok(entries) => entries,
            Err(_) => continue,
        };

        while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
            let child_path = entry.path();
            let child_name = entry.file_name().to_string_lossy().to_string();
            let child_meta = match entry.metadata().await {
                Ok(meta) => meta,
                Err(_) => continue,
            };

            if child_meta.is_dir() {
                if !should_skip_tree_entry(&child_name)
                    || matches!(child_name.as_str(), "dist" | "build")
                {
                    stack.push((child_path, depth + 1));
                }
                continue;
            }

            if is_html_file(&child_path) {
                let score = entry_score(&root, &child_path, depth);
                matches.push((score, child_path.to_string_lossy().to_string()));
            }
        }
    }

    matches.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    Ok(matches.into_iter().map(|(_, path)| path).next())
}

fn is_html_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| matches!(ext.to_lowercase().as_str(), "html" | "htm" | "xhtml"))
        .unwrap_or(false)
}

fn entry_score(root: &Path, path: &Path, depth: usize) -> usize {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_lowercase();
    let relative = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
        .to_lowercase();

    if file_name == "index.html" && depth == 0 {
        return 0;
    }
    if file_name == "index.htm" && depth == 0 {
        return 1;
    }
    if relative == "dist/index.html" || relative == "build/index.html" {
        return 2;
    }
    if file_name == "index.html" {
        return 10 + depth;
    }
    if matches!(file_name.as_str(), "home.html" | "main.html" | "app.html") {
        return 30 + depth;
    }
    100 + depth
}

#[tauri::command]
pub async fn read_text_file(path: String) -> CmdResult<String> {
    let path = PathBuf::from(path);
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("Path is not a file".into());
    }
    if metadata.len() > 20 * 1024 * 1024 {
        return Err("File is too large to preview as text".into());
    }
    tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_binary_preview(path: String) -> CmdResult<BinaryPreview> {
    let path = PathBuf::from(path);
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("Path is not a file".into());
    }
    if metadata.len() > 40 * 1024 * 1024 {
        return Err("File is too large for inline preview".into());
    }

    let mime = mime_for_preview(&path)
        .ok_or_else(|| "This file type is not supported for inline preview".to_string())?;
    let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string());

    Ok(BinaryPreview {
        name,
        mime: mime.to_string(),
        data_url: format!("data:{};base64,{}", mime, encoded),
        size: metadata.len(),
    })
}

fn mime_for_preview(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_lowercase();
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "pdf" => Some("application/pdf"),
        _ => None,
    }
}

#[tauri::command]
pub async fn open_html_file(
    state: State<'_, AppState>,
    path: String,
) -> CmdResult<serde_json::Value> {
    let ctx = agent_context_with_config(&state).await;
    let orch = state.orchestrator.lock().await;
    let params = serde_json::json!({"path": path});
    let req = UserRequest {
        id: uuid::Uuid::new_v4().to_string(),
        command: "open".into(),
        parameters: params,
        context: RequestContext::default(),
    };
    let workflow = orch.plan(&req).await.map_err(|e| e.to_string())?;
    let results = orch
        .execute_workflow(&workflow.id, &ctx)
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(results).map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn get_document_info(
    state: State<'_, AppState>,
    html_content: String,
) -> CmdResult<serde_json::Value> {
    let _orch = state.orchestrator.lock().await;
    let ctx = AgentContext::default();
    let params = serde_json::json!({"html": html_content});
    let agent = seehtml_agents::document::DocumentAgent::new();
    let doc = agent
        .execute("read_html_string", params, &ctx)
        .await
        .map_err(|e| e.to_string())?;
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
    let ctx = agent_context_with_config(&state).await;
    let orch = state.orchestrator.lock().await;
    let workflow = orch
        .plan(&UserRequest {
            id: uuid::Uuid::new_v4().to_string(),
            command: action.clone(),
            parameters: params,
            context: RequestContext::default(),
        })
        .await
        .map_err(|e| e.to_string())?;
    let results = orch
        .execute_workflow(&workflow.id, &ctx)
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(results).map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn run_workflow(
    state: State<'_, AppState>,
    command: String,
    params: serde_json::Value,
) -> CmdResult<serde_json::Value> {
    let ctx = agent_context_with_config(&state).await;
    let orch = state.orchestrator.lock().await;
    let req = UserRequest {
        id: uuid::Uuid::new_v4().to_string(),
        command,
        parameters: params,
        context: RequestContext::default(),
    };
    let workflow = orch.plan(&req).await.map_err(|e| e.to_string())?;
    let results = orch
        .execute_workflow(&workflow.id, &ctx)
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(results).map_err(|e| e.to_string())?)
}

async fn agent_context_with_config(state: &State<'_, AppState>) -> AgentContext {
    let mut ctx = AgentContext::default();
    ctx.config = Some(state.ai_config.lock().await.clone());
    ctx
}

#[tauri::command]
pub async fn export_document(
    _state: State<'_, AppState>,
    html: String,
    format: String,
    theme: Option<serde_json::Value>,
    output_path: Option<String>,
) -> CmdResult<serde_json::Value> {
    let theme: PresentationTheme = theme
        .and_then(|t| serde_json::from_value(t).ok())
        .unwrap_or_default();
    let title = extract_html_title(&html).unwrap_or_else(|| "document".into());
    let sections = extract_page_sections(&html, &title);
    let doc = Document {
        id: uuid::Uuid::new_v4().to_string(),
        title: title.clone(),
        source_path: None,
        html_content: html.clone(),
        metadata: DocumentMetadata::default(),
        sections,
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
            let mut markdown = format!("# {}\n\n", doc.title);
            for (index, section) in doc.sections.iter().enumerate() {
                let heading = section.heading.as_deref().unwrap_or("Page");
                markdown.push_str(&format!(
                    "## {}. {}\n\n{}\n\n",
                    index + 1,
                    heading,
                    section.content
                ));
            }
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
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
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
    if title.is_empty() {
        None
    } else {
        Some(title.into())
    }
}

fn extract_page_sections(html: &str, fallback_title: &str) -> Vec<DocumentSection> {
    let fragments = extract_section_fragments(html)
        .into_iter()
        .filter(|fragment| is_meaningful_section_fragment(fragment))
        .collect::<Vec<_>>();
    let page_fragments = if fragments.is_empty() {
        vec![html.to_string()]
    } else {
        fragments
    };

    page_fragments
        .iter()
        .enumerate()
        .map(|(index, fragment)| {
            let heading = extract_fragment_heading(fragment)
                .unwrap_or_else(|| format!("{} {}", fallback_title, index + 1));
            DocumentSection {
                id: format!("page-{}", index + 1),
                level: 1,
                heading: Some(heading),
                content: strip_html_tags(fragment),
                assets: vec![],
                style_id: None,
            }
        })
        .collect()
}

fn extract_section_fragments(html: &str) -> Vec<String> {
    let lower = html.to_lowercase();
    let mut fragments = Vec::new();
    let mut pos = 0usize;

    while let Some(rel_start) = lower[pos..].find("<section") {
        let start = pos + rel_start;
        let Some(rel_open_end) = lower[start..].find('>') else {
            break;
        };
        let open_end = start + rel_open_end + 1;
        let Some(rel_end) = lower[open_end..].find("</section>") else {
            break;
        };
        let end = open_end + rel_end + "</section>".len();
        fragments.push(html[start..end].to_string());
        pos = end;
    }

    fragments
}

fn is_meaningful_section_fragment(fragment: &str) -> bool {
    let lower = fragment.to_lowercase();
    let text = strip_html_tags(fragment).replace(char::is_whitespace, "");
    text.chars().count() >= 8
        || lower.contains("<img")
        || lower.contains("<video")
        || lower.contains("<canvas")
        || lower.contains("<svg")
        || lower.contains("<iframe")
}

fn extract_fragment_heading(fragment: &str) -> Option<String> {
    let lower = fragment.to_lowercase();
    for tag in ["h1", "h2", "h3"] {
        let open = format!("<{}", tag);
        let close = format!("</{}>", tag);
        let Some(start) = lower.find(&open) else {
            continue;
        };
        let Some(rel_tag_end) = lower[start..].find('>') else {
            continue;
        };
        let tag_end = rel_tag_end + start + 1;
        let Some(rel_end) = lower[tag_end..].find(&close) else {
            continue;
        };
        let end = rel_end + tag_end;
        let heading = strip_html_tags(&fragment[tag_end..end]);
        if !heading.trim().is_empty() {
            return Some(heading);
        }
    }
    None
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
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    stem.truncate(80);
    if stem.trim_matches('_').is_empty() {
        "document".into()
    } else {
        stem
    }
}

#[tauri::command]
pub async fn update_ai_config(
    state: State<'_, AppState>,
    provider: Option<String>,
    api_url: String,
    api_key: String,
    model: String,
    temperature: Option<f64>,
    max_tokens: Option<u32>,
    use_auth_header: Option<bool>,
    supports_vision: Option<bool>,
    use_default_ocr: Option<bool>,
) -> CmdResult<serde_json::Value> {
    let api_url = api_url.trim().to_string();
    let model = model.trim().to_string();
    if api_url.is_empty() {
        return Err("API URL is required".into());
    }
    if model.is_empty() {
        return Err("Model is required".into());
    }

    let Some(config_path) = user_ai_config_path() else {
        return Err("Cannot resolve user config directory".into());
    };
    if let Some(parent) = config_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }

    let config = AiConfig {
        provider: provider
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "custom".into()),
        api_url,
        api_key,
        model,
        temperature: temperature.unwrap_or(0.7).clamp(0.0, 2.0),
        max_tokens: max_tokens.unwrap_or(8192).clamp(1, 262_144),
        use_auth_header: use_auth_header.unwrap_or(true),
        supports_vision: supports_vision.unwrap_or(false),
        use_default_ocr: use_default_ocr.unwrap_or(true),
    };
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    tokio::fs::write(&config_path, content)
        .await
        .map_err(|e| e.to_string())?;

    {
        let mut runtime_config = state.ai_config.lock().await;
        *runtime_config = config.clone();
    }
    {
        let mut agent_loop = state.agent_loop.lock().await;
        agent_loop.config = config.clone();
    }

    Ok(serde_json::json!({
        "config": config,
        "config_path": config_path.to_string_lossy(),
        "configured": true,
    }))
}

#[tauri::command]
pub async fn get_ai_config(state: State<'_, AppState>) -> CmdResult<serde_json::Value> {
    let config = state.ai_config.lock().await.clone();
    Ok(serde_json::json!({
        "config": config,
        "config_path": user_ai_config_path().map(|path| path.to_string_lossy().to_string()),
        "configured": !config.api_url.trim().is_empty() && !config.model.trim().is_empty(),
    }))
}

fn user_ai_config_path() -> Option<PathBuf> {
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
    session_id: Option<String>,
    project_dir: Option<String>,
    current_file: Option<String>,
    current_html: Option<String>,
    memory: Option<serde_json::Value>,
) -> CmdResult<serde_json::Value> {
    let msgs: Vec<LlmMessage> = serde_json::from_value(messages).map_err(|e| e.to_string())?;
    let runtime_context =
        build_agent_runtime_context(session_id, project_dir, current_file, current_html, memory);

    let tool_defs = if let Some(t) = tools {
        serde_json::from_value(t).map_err(|e| e.to_string())?
    } else {
        // Build tools from registered agents
        let orch = state.orchestrator.lock().await;
        let agents = orch.list_agents().await;
        let mut agent_caps: std::collections::HashMap<
            AgentId,
            Vec<seehtml_agents::AgentCapability>,
        > = std::collections::HashMap::new();
        for a in &agents {
            let caps: Vec<seehtml_agents::AgentCapability> = a
                .capabilities
                .iter()
                .map(|c| seehtml_agents::AgentCapability {
                    action: c.action.clone(),
                    description: c.description.clone(),
                    parameters: c.parameters.clone(),
                })
                .collect();
            agent_caps.insert(a.id.clone(), caps);
        }
        AgentLoop::build_tools(&agent_caps)
    };
    let tool_defs = filter_core_agent_tools(tool_defs);

    let request = AgentLoopRequest {
        messages: msgs,
        tools: tool_defs,
        system_prompt: system_prompt.or_else(|| {
            Some(
                "You are SeeHTML AI, an open-source HTML creation agent. \
             Core capabilities are: generate or edit complete previewable HTML, \
             export the current HTML to PPTX when explicitly requested, and prepare \
             MP4-ready HTML when the user explicitly asks for video export. \
             MP4 rendering is handled by the app preview pipeline, not by an LLM tool. \
             Do not claim to run OCR, publishing, theme, Markdown, or media-processing tools. \
             Use tools only when they are necessary and available. \
             Respond in Chinese if the user writes in Chinese."
                    .into(),
            )
        }),
        max_iterations: max_iterations.unwrap_or(10),
        runtime_context,
    };

    let agent_loop = state.agent_loop.lock().await;
    let result = agent_loop
        .chat_planned(request)
        .await
        .map_err(|e| e.to_string())?;
    Ok(serde_json::to_value(result).map_err(|e| e.to_string())?)
}

fn build_agent_runtime_context(
    session_id: Option<String>,
    project_dir: Option<String>,
    current_file: Option<String>,
    current_html: Option<String>,
    memory: Option<serde_json::Value>,
) -> AgentRuntimeContext {
    let project_dir = non_empty_path(project_dir);
    let current_file = non_empty_path(current_file);
    let current_document = current_html
        .as_deref()
        .filter(|html| !html.trim().is_empty())
        .map(|html| document_from_current_html(html, current_file.as_ref()));

    AgentRuntimeContext {
        session_id: session_id.filter(|value| !value.trim().is_empty()),
        project_dir,
        current_file,
        current_document,
        selected_text: None,
        memory_snippets: memory_snippets_from_value(memory),
        previous_results: std::collections::HashMap::new(),
    }
}

fn non_empty_path(value: Option<String>) -> Option<PathBuf> {
    value
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
}

fn document_from_current_html(html: &str, current_file: Option<&PathBuf>) -> Document {
    let title = extract_html_title(html)
        .or_else(|| {
            current_file
                .and_then(|path| path.file_stem())
                .and_then(|name| name.to_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "document".into());
    let sections = extract_page_sections(html, &title);

    Document {
        id: uuid::Uuid::new_v4().to_string(),
        title,
        source_path: current_file.cloned(),
        html_content: html.to_string(),
        metadata: DocumentMetadata::default(),
        sections,
        assets: vec![],
        styles: vec![],
    }
}

fn memory_snippets_from_value(memory: Option<serde_json::Value>) -> Vec<MemorySnippet> {
    let Some(serde_json::Value::Object(map)) = memory else {
        return Vec::new();
    };

    map.into_iter()
        .filter_map(|(key, value)| {
            if key.trim().is_empty() {
                return None;
            }
            let value = value
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| value.to_string());
            if value.trim().is_empty() {
                return None;
            }
            Some(MemorySnippet {
                key,
                value,
                source: Some("project-sqlite".into()),
            })
        })
        .take(40)
        .collect()
}

/// Get all available tool definitions (for client-side tool display)
#[tauri::command]
pub async fn get_tools(state: State<'_, AppState>) -> CmdResult<serde_json::Value> {
    let orch = state.orchestrator.lock().await;
    let agents = orch.list_agents().await;

    let mut agent_caps: std::collections::HashMap<AgentId, Vec<seehtml_agents::AgentCapability>> =
        std::collections::HashMap::new();
    for a in &agents {
        let caps: Vec<seehtml_agents::AgentCapability> = a
            .capabilities
            .iter()
            .map(|c| seehtml_agents::AgentCapability {
                action: c.action.clone(),
                description: c.description.clone(),
                parameters: c.parameters.clone(),
            })
            .collect();
        agent_caps.insert(a.id.clone(), caps);
    }

    let tools = AgentLoop::build_tools(&agent_caps);
    let tools = filter_core_agent_tools(tools);
    Ok(serde_json::to_value(tools).map_err(|e| e.to_string())?)
}

fn filter_core_agent_tools(tools: Vec<ToolDefinition>) -> Vec<ToolDefinition> {
    tools
        .into_iter()
        .filter(|tool| is_core_agent_tool(&tool.name))
        .collect()
}

fn is_core_agent_tool(name: &str) -> bool {
    matches!(
        name,
        "content_generate" | "content_enhance_html" | "export_export_pptx"
    )
}

/// Save captured PNG image to disk
#[tauri::command]
pub async fn save_image(
    _state: State<'_, AppState>,
    data_url: String,
    index: Option<u32>,
    output_dir: Option<String>,
) -> CmdResult<String> {
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
    let dir = output_dir.unwrap_or_else(|| "./output".into());
    let path = std::path::PathBuf::from(dir).join(format!("slide_{}.png", idx));
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    tokio::fs::write(&path, &bytes)
        .await
        .map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn clear_rendered_frames(frames_dir: String) -> CmdResult<()> {
    let dir = PathBuf::from(frames_dir);
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| e.to_string())?;

    let mut entries = tokio::fs::read_dir(&dir).await.map_err(|e| e.to_string())?;
    while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
        let path = entry.path();
        let is_frame = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.starts_with("slide_") && name.ends_with(".png"))
            .unwrap_or(false);
        if is_frame {
            tokio::fs::remove_file(path)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

/// Resolve bundled resource path (production next to exe, dev from project root)
fn resource_path(relative: &str) -> std::path::PathBuf {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_default();

    // Production: resources extracted next to exe
    let prod = exe_dir.join(relative);
    if prod.exists() {
        return prod;
    }

    // Try _up from exe (Tauri v2 extracts resources)
    for up in 0..4 {
        let mut p = exe_dir.clone();
        for _ in 0..up {
            p = p.join("..");
        }
        let candidate = p.join(relative);
        if candidate.exists() {
            return candidate;
        }
    }

    // Dev fallback: project root
    let dev = std::path::PathBuf::from(relative);
    if dev.exists() {
        return dev;
    }

    // Return prod path anyway (caller handles missing)
    prod
}

/// Run OCR on an image using bundled Python
#[tauri::command]
pub async fn run_ocr(
    _state: State<'_, AppState>,
    image_path: String,
    engine: Option<String>,
) -> CmdResult<serde_json::Value> {
    let engine = engine.unwrap_or_else(|| "easyocr".into()); // Default easyocr = no Tesseract needed
    let python_exe = resource_path("python/python.exe");
    let python_script = resource_path("python/ocr_service.py");

    let py_cmd = if python_exe.exists() {
        python_exe.to_string_lossy().to_string()
    } else {
        "python".into()
    };
    let script = if python_script.exists() {
        python_script.to_string_lossy().to_string()
    } else {
        "./python/ocr_service.py".into()
    };

    let output = tokio::process::Command::new(&py_cmd)
        .arg(&script)
        .arg(&image_path)
        .arg("--engine")
        .arg(&engine)
        .arg("--lang")
        .arg("chi_sim+eng")
        .output()
        .await
        .map_err(|e| format!("OCR failed - ensure Python is installed: {}", e))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(serde_json::from_str(&stdout).unwrap_or(serde_json::json!({"text": stdout})))
    } else {
        Err(format!(
            "OCR error: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

/// Generate video from slide images using bundled ffmpeg
#[tauri::command]
pub async fn generate_video(
    _state: State<'_, AppState>,
    slide_count: u32,
    output_path: Option<String>,
    frame_rate: Option<f64>,
    frames_dir: Option<String>,
) -> CmdResult<String> {
    if slide_count == 0 {
        return Err("No rendered frames found for MP4 export".into());
    }

    let out = output_path.unwrap_or_else(|| "./output/presentation.mp4".into());
    let out_path = absolute_path(&out);
    if let Some(parent) = out_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }

    let ffmpeg_cmd = find_ffmpeg_command();
    let input_fps = frame_rate.unwrap_or(1.0 / 3.0).clamp(0.1, 60.0);
    let output_fps = if input_fps < 1.0 {
        30.0
    } else {
        input_fps.round().clamp(1.0, 60.0)
    };
    let input_fps_arg = format_fps_arg(input_fps);
    let output_fps_arg = format_fps_arg(output_fps);
    let output_frame_count = ((slide_count as f64) * (output_fps / input_fps))
        .ceil()
        .max(1.0) as u64;
    let frame_count_arg = output_frame_count.to_string();
    let frame_root = frames_dir.unwrap_or_else(|| "./output".into());
    let input_pattern = absolute_path(PathBuf::from(frame_root).join("slide_%d.png"));
    let input_pattern_arg = input_pattern.to_string_lossy().to_string();
    let out_arg = out_path.to_string_lossy().to_string();

    let mut command = tokio::process::Command::new(&ffmpeg_cmd);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);

    let output = command
        .args([
            "-y",
            "-framerate", &input_fps_arg,
            "-start_number", "0",
            "-i", &input_pattern_arg,
            "-frames:v", &frame_count_arg,
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", "18",
            "-r", &output_fps_arg,
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,format=yuv420p",
            &out_arg,
        ])
        .output().await
        .map_err(|e| format!("ffmpeg error: {}", e))?;

    if output.status.success() {
        Ok(out_arg)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err(format!("ffmpeg failed. Command: {}", ffmpeg_cmd))
        } else {
            Err(format!("ffmpeg failed: {}", stderr))
        }
    }
}

fn find_ffmpeg_command() -> String {
    for relative in ["ffmpeg/bin/ffmpeg.exe", "ffmpeg/ffmpeg.exe"] {
        let path = resource_path(relative);
        if path.exists() {
            return path.to_string_lossy().to_string();
        }
    }
    "ffmpeg".into()
}

fn absolute_path(path: impl AsRef<Path>) -> std::path::PathBuf {
    let path = path.as_ref();
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_default().join(path)
    }
}

fn format_fps_arg(fps: f64) -> String {
    if (fps.fract()).abs() < f64::EPSILON {
        format!("{}", fps as u32)
    } else {
        format!("{:.3}", fps)
    }
}

/// Save document as HTML file
#[tauri::command]
pub async fn save_html(
    _state: State<'_, AppState>,
    html: String,
    path: Option<String>,
) -> CmdResult<String> {
    let p = path.unwrap_or_else(|| "./output/document.html".into());
    let pb = std::path::PathBuf::from(&p);
    if let Some(parent) = pb.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    tokio::fs::write(&pb, &html)
        .await
        .map_err(|e| e.to_string())?;
    Ok(p)
}

fn project_memory_db_path(project_path: &str) -> CmdResult<PathBuf> {
    let trimmed = project_path.trim();
    if trimmed.is_empty() {
        return Err("Project path is required for memory".into());
    }
    Ok(PathBuf::from(trimmed)
        .join(".seehtml")
        .join("memory.sqlite3"))
}

fn init_memory_db(conn: &Connection) -> CmdResult<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS memories (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_memories_updated_at ON memories(updated_at);

        CREATE TABLE IF NOT EXISTS context_index (
            path TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT '',
            snippet TEXT NOT NULL,
            hash TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_context_updated_at ON context_index(updated_at);
        "#,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

async fn with_project_memory_db<T, F>(project_path: String, f: F) -> CmdResult<T>
where
    T: Send + 'static,
    F: FnOnce(&Connection) -> CmdResult<T> + Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        let db_path = project_memory_db_path(&project_path)?;
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        init_memory_db(&conn)?;
        f(&conn)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn memory_cache_key(project_path: &str, key: &str) -> String {
    format!("{}::{}", project_path.trim(), key.trim())
}

fn clamp_memory_limit(limit: Option<u32>, default_limit: u32) -> i64 {
    i64::from(limit.unwrap_or(default_limit).clamp(1, 200))
}

fn map_memory_row(
    row: &rusqlite::Row<'_>,
    kind: &str,
    source_index: Option<usize>,
) -> rusqlite::Result<MemoryRecord> {
    Ok(MemoryRecord {
        key: row.get(0)?,
        value: row.get(1)?,
        kind: kind.to_string(),
        source: match source_index {
            Some(index) => row.get(index)?,
            None => None,
        },
        updated_at: row.get(2)?,
    })
}

/// Get project-scoped memory from .seehtml/memory.sqlite3.
#[tauri::command]
pub async fn get_memory(
    state: State<'_, AppState>,
    project_path: String,
    key: String,
) -> CmdResult<Option<String>> {
    let db_value = with_project_memory_db(project_path.clone(), {
        let key = key.clone();
        move |conn| {
            conn.query_row(
                "SELECT value FROM memories WHERE key = ?1",
                params![key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())
        }
    })
    .await?;

    if db_value.is_some() {
        return Ok(db_value);
    }

    let orch = state.orchestrator.lock().await;
    let cache = orch.results_cache.read().await;
    let namespaced_key = memory_cache_key(&project_path, &key);
    Ok(cache
        .get(&namespaced_key)
        .or_else(|| cache.get(&key))
        .and_then(|v| v.as_str().map(|s| s.to_string())))
}

/// Set project-scoped memory.
#[tauri::command]
pub async fn set_memory(
    state: State<'_, AppState>,
    project_path: String,
    key: String,
    value: String,
) -> CmdResult<()> {
    let updated_at = chrono::Utc::now().to_rfc3339();
    with_project_memory_db(project_path.clone(), {
        let key = key.clone();
        let value = value.clone();
        let updated_at = updated_at.clone();
        move |conn| {
            conn.execute(
                r#"
                INSERT INTO memories (key, value, updated_at)
                VALUES (?1, ?2, ?3)
                ON CONFLICT(key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
                "#,
                params![key, value, updated_at],
            )
            .map_err(|e| e.to_string())?;
            Ok(())
        }
    })
    .await?;

    let orch = state.orchestrator.lock().await;
    orch.results_cache.write().await.insert(
        memory_cache_key(&project_path, &key),
        serde_json::json!(value),
    );
    Ok(())
}

#[tauri::command]
pub async fn list_memory(project_path: String, limit: Option<u32>) -> CmdResult<Vec<MemoryRecord>> {
    let limit = clamp_memory_limit(limit, 80);
    with_project_memory_db(project_path, move |conn| {
        let mut stmt = conn
            .prepare(
                "SELECT key, value, updated_at FROM memories ORDER BY updated_at DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], |row| map_memory_row(row, "memory", None))
            .map_err(|e| e.to_string())?;
        rows.collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())
    })
    .await
}

#[tauri::command]
pub async fn search_memory(
    project_path: String,
    query: String,
    limit: Option<u32>,
) -> CmdResult<Vec<MemoryRecord>> {
    let limit = clamp_memory_limit(limit, 40);
    with_project_memory_db(project_path, move |conn| {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            let mut stmt = conn
                .prepare(
                    "SELECT key, value, updated_at FROM memories ORDER BY updated_at DESC LIMIT ?1",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![limit], |row| map_memory_row(row, "memory", None))
                .map_err(|e| e.to_string())?;
            return rows
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(|e| e.to_string());
        }

        let pattern = format!("%{}%", trimmed);
        let memory_limit = (limit / 2).max(1);
        let context_limit = (limit - memory_limit).max(1);
        let mut output = Vec::new();

        {
            let mut stmt = conn
                .prepare(
                    "SELECT key, value, updated_at FROM memories
                     WHERE key LIKE ?1 OR value LIKE ?1
                     ORDER BY updated_at DESC LIMIT ?2",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![&pattern, memory_limit], |row| {
                    map_memory_row(row, "memory", None)
                })
                .map_err(|e| e.to_string())?;
            output.extend(
                rows.collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(|e| e.to_string())?,
            );
        }

        {
            let mut stmt = conn
                .prepare(
                    "SELECT path, snippet, updated_at, path FROM context_index
                     WHERE path LIKE ?1 OR title LIKE ?1 OR snippet LIKE ?1
                     ORDER BY updated_at DESC LIMIT ?2",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![&pattern, context_limit], |row| {
                    map_memory_row(row, "context", Some(3))
                })
                .map_err(|e| e.to_string())?;
            output.extend(
                rows.collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(|e| e.to_string())?,
            );
        }

        Ok(output)
    })
    .await
}

#[tauri::command]
pub async fn refresh_context_index(
    project_path: String,
    limit: Option<u32>,
) -> CmdResult<serde_json::Value> {
    let limit = usize::try_from(limit.unwrap_or(120).clamp(1, 500)).unwrap_or(120);
    let project_path_for_db = project_path.clone();
    with_project_memory_db(project_path_for_db, move |conn| {
        let root = PathBuf::from(project_path.trim());
        if !root.is_dir() {
            return Err("Project path is not a directory".into());
        }

        let mut files = Vec::new();
        collect_context_files(&root, &mut files, limit);
        conn.execute("DELETE FROM context_index", [])
            .map_err(|e| e.to_string())?;

        let updated_at = chrono::Utc::now().to_rfc3339();
        let mut indexed = 0usize;
        for file in files {
            let Ok(text) = std::fs::read_to_string(&file) else {
                continue;
            };
            let relative = file
                .strip_prefix(&root)
                .unwrap_or(&file)
                .to_string_lossy()
                .replace('\\', "/");
            let title = file
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("document")
                .to_string();
            let snippet = compact_text(&text, 6000);
            let hash = file_hash_marker(&file);
            conn.execute(
                r#"
                INSERT INTO context_index (path, title, snippet, hash, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5)
                ON CONFLICT(path) DO UPDATE SET
                    title = excluded.title,
                    snippet = excluded.snippet,
                    hash = excluded.hash,
                    updated_at = excluded.updated_at
                "#,
                params![relative, title, snippet, hash, updated_at],
            )
            .map_err(|e| e.to_string())?;
            indexed += 1;
        }

        Ok(serde_json::json!({
            "indexed": indexed,
            "database": project_memory_db_path(project_path.trim())?.to_string_lossy(),
        }))
    })
    .await
}

fn collect_context_files(root: &Path, output: &mut Vec<PathBuf>, limit: usize) {
    if output.len() >= limit {
        return;
    }
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        if output.len() >= limit {
            return;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            if should_skip_tree_entry(&name) || name == "exports" {
                continue;
            }
            collect_context_files(&path, output, limit);
        } else if context_file_allowed(&path, metadata.len()) {
            output.push(path);
        }
    }
}

fn context_file_allowed(path: &Path, size: u64) -> bool {
    if size == 0 || size > 1_000_000 {
        return false;
    }
    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase())
            .as_deref(),
        Some("html" | "htm" | "md" | "txt" | "css" | "js" | "ts" | "tsx" | "jsx" | "json")
    )
}

fn compact_text(text: &str, max_chars: usize) -> String {
    let mut compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.chars().count() > max_chars {
        compact = compact.chars().take(max_chars).collect::<String>();
    }
    compact
}

fn file_hash_marker(path: &Path) -> String {
    let Ok(metadata) = std::fs::metadata(path) else {
        return "unknown".into();
    };
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    format!("{}:{}", metadata.len(), modified)
}
