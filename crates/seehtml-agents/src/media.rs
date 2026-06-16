//! MediaAgent - Video, audio, and subtitle processing via FFmpeg
use crate::{Agent, AgentCapability, AgentContext, CapabilityParameter};
use async_trait::async_trait;
use seehtml_core::*;
use std::path::PathBuf;

#[allow(dead_code)]
pub struct MediaAgent { state: AgentState, ffmpeg_path: PathBuf }

impl MediaAgent {
    pub fn new(ffmpeg_path: Option<PathBuf>) -> Self {
        Self { state: AgentState::Idle, ffmpeg_path: ffmpeg_path.unwrap_or_else(|| PathBuf::from("ffmpeg")) }
    }

    fn parse_srt(content: &str) -> Vec<SubtitleEntry> {
        let mut entries = Vec::new();
        let blocks: Vec<&str> = content.split("

").collect();
        for block in blocks {
            let lines: Vec<&str> = block.lines().collect();
            if lines.len() >= 3 {
                if let Ok(index) = lines[0].trim().parse() {
                    if let Some(arrow) = lines[1].find(" --> ") {
                        entries.push(SubtitleEntry {
                            index,
                            start_time: lines[1][..arrow].trim().to_string(),
                            end_time: lines[1][arrow + 5..].trim().to_string(),
                            text: lines[2..].join("
"),
                        });
                    }
                }
            }
        }
        entries
    }

    fn parse_vtt(content: &str) -> Vec<SubtitleEntry> {
        let clean = content.replace("
", "
");
        let after_header = if let Some(pos) = clean.find("

") { &clean[pos+2..] } else { &clean };
        Self::parse_srt(after_header)
    }
}

#[async_trait]
impl Agent for MediaAgent {
    fn id(&self) -> AgentId { AgentId::Media }
    fn state(&self) -> AgentState { self.state.clone() }
    async fn initialize(&mut self) -> Result<()> { self.state = AgentState::Idle; Ok(()) }

    async fn execute(&self, action: &str, params: serde_json::Value, _ctx: &AgentContext) -> Result<serde_json::Value> {
        match action {
            "process" => {
                let file_path = params.get("path").and_then(|v| v.as_str()).unwrap_or("");
                let ext = std::path::Path::new(file_path).extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                let info = MediaInfo {
                    path: PathBuf::from(file_path),
                    media_type: match ext.as_str() {
                        "mp4" | "mov" | "avi" | "webm" => AssetType::Video,
                        "mp3" | "wav" | "m4a" | "aac" | "ogg" | "flac" => AssetType::Audio,
                        "srt" | "vtt" => AssetType::Subtitle,
                        "png" | "jpg" | "jpeg" | "gif" | "bmp" | "webp" => AssetType::Image,
                        _ => AssetType::Other(ext.clone()),
                    },
                    duration_secs: None, codec: None, width: None, height: None, bitrate: None,
                };
                Ok(serde_json::to_value(info)?)
            }
            "parse_subtitle" => {
                let content = params.get("content").and_then(|v| v.as_str()).unwrap_or("");
                let ext = params.get("format").and_then(|v| v.as_str()).unwrap_or("srt");
                let entries = match ext {
                    "vtt" => Self::parse_vtt(content),
                    _ => Self::parse_srt(content),
                };
                Ok(serde_json::to_value(entries)?)
            }
            "ocr" => {
                let image_path = params.get("image_path").and_then(|v| v.as_str()).unwrap_or("");
                let engine = params.get("engine").and_then(|v| v.as_str()).unwrap_or("tesseract");
                // Return instructions for the caller to use run_ocr command
                Ok(serde_json::json!({
                    "status": "ready",
                    "message": format!("OCR requested for: {} using engine: {}", image_path, engine),
                    "image_path": image_path,
                    "engine": engine
                }))
            }
            "generate_video" => {
                let slide_count = params.get("slide_count").and_then(|v| v.as_u64()).unwrap_or(1) as u32;
                Ok(serde_json::json!({
                    "status": "ready",
                    "message": format!("Video generation requested for {} slides", slide_count),
                    "slide_count": slide_count
                }))
            }
            _ => Err(SeeHtmlError::AgentError { agent: "MediaAgent".into(), message: format!("Unknown action: {}", action) }),
        }
    }

    fn capabilities(&self) -> Vec<AgentCapability> {
        vec![
            AgentCapability { action: "process".into(), description: "Process media/image file, extract metadata (supports PNG, JPG, MP4, SRT, etc)".into(),
                parameters: vec![CapabilityParameter { name: "path".into(), param_type: "string".into(), description: "Media file path".into(), required: true }] },
            AgentCapability { action: "parse_subtitle".into(), description: "Parse SRT/VTT subtitle files into structured data".into(),
                parameters: vec![
                    CapabilityParameter { name: "content".into(), param_type: "string".into(), description: "Raw subtitle text content".into(), required: true },
                    CapabilityParameter { name: "format".into(), param_type: "string".into(), description: "Subtitle format: srt or vtt".into(), required: false },
                ]},
            AgentCapability { action: "ocr".into(), description: "Extract text from images using OCR (Tesseract/EasyOCR via Python)".into(),
                parameters: vec![
                    CapabilityParameter { name: "image_path".into(), param_type: "string".into(), description: "Path to image file".into(), required: true },
                    CapabilityParameter { name: "engine".into(), param_type: "string".into(), description: "OCR engine: tesseract or easyocr".into(), required: false },
                ]},
            AgentCapability { action: "generate_video".into(), description: "Combine slide images into MP4 video using ffmpeg".into(),
                parameters: vec![CapabilityParameter { name: "slide_count".into(), param_type: "number".into(), description: "Number of slides".into(), required: true }]},
        ]
    }
}