use std::path::PathBuf;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum SeeHtmlError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("File not found: {0}")]
    FileNotFound(PathBuf),

    #[error("Unsupported format: {0}")]
    UnsupportedFormat(String),

    #[error("Agent error [{agent}]: {message}")]
    AgentError { agent: String, message: String },

    #[error("Orchestration error: {0}")]
    OrchestrationError(String),

    #[error("AI API error: {0}")]
    AiApiError(String),

    #[error("FFmpeg error: {0}")]
    FfmpegError(String),

    #[error("Invalid document: {0}")]
    InvalidDocument(String),

    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, SeeHtmlError>;
