//! Ref entity and normalization logic

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use url::Url;
use uuid::Uuid;

/// Reference kind
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(rename_all = "snake_case")]
pub enum RefKind {
    Url,
    FilePath,
    IssueKey,
    Custom,
}

impl RefKind {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "url" => Some(Self::Url),
            "file_path" => Some(Self::FilePath),
            "issue_key" => Some(Self::IssueKey),
            "custom" => Some(Self::Custom),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Url => "url",
            Self::FilePath => "file_path",
            Self::IssueKey => "issue_key",
            Self::Custom => "custom",
        }
    }
}

/// Reference entity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ref {
    pub id: Uuid,
    pub kind: RefKind,
    pub value: String,
    pub normalized_value: String,
    pub created_at: DateTime<Utc>,
}

impl Ref {
    /// Create a new ref with automatic normalization
    pub fn new(kind: RefKind, value: String) -> Result<Self, RefNormalizationError> {
        let normalized_value = normalize_ref_value(kind, &value)?;
        Ok(Self {
            id: Uuid::new_v4(),
            kind,
            value,
            normalized_value,
            created_at: Utc::now(),
        })
    }
}

/// Error during ref normalization
#[derive(Debug, thiserror::Error)]
pub enum RefNormalizationError {
    #[error("Empty value")]
    EmptyValue,
    #[error("Invalid URL: {0}")]
    InvalidUrl(String),
    #[error("Invalid file path")]
    InvalidFilePath,
}

/// Normalize a ref value based on its kind
pub fn normalize_ref_value(kind: RefKind, value: &str) -> Result<String, RefNormalizationError> {
    let trimmed = value.trim();
    
    if trimmed.is_empty() {
        return Err(RefNormalizationError::EmptyValue);
    }

    match kind {
        RefKind::Url => normalize_url(trimmed),
        RefKind::FilePath => normalize_file_path(trimmed),
        RefKind::IssueKey => normalize_issue_key(trimmed),
        RefKind::Custom => Ok(trimmed.to_string()),
    }
}

/// Normalize URL: lowercase scheme and host, remove fragment
fn normalize_url(value: &str) -> Result<String, RefNormalizationError> {
    match Url::parse(value) {
        Ok(mut url) => {
            // Remove fragment
            url.set_fragment(None);
            
            // Remove common tracking parameters (optional, conservative approach)
            // For now, just return the URL without fragment
            Ok(url.to_string().to_lowercase())
        }
        Err(e) => Err(RefNormalizationError::InvalidUrl(e.to_string())),
    }
}

/// Normalize file path: normalize separators, trim
fn normalize_file_path(value: &str) -> Result<String, RefNormalizationError> {
    // Replace backslashes with forward slashes for consistency
    let normalized = value.replace('\\', "/");
    
    // Remove trailing slashes
    let normalized = normalized.trim_end_matches('/');
    
    if normalized.is_empty() {
        return Err(RefNormalizationError::InvalidFilePath);
    }
    
    Ok(normalized.to_string())
}

/// Normalize issue key: uppercase
fn normalize_issue_key(value: &str) -> Result<String, RefNormalizationError> {
    Ok(value.to_uppercase())
}

/// Ref view for API responses
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefView {
    pub id: Uuid,
    pub kind: String,
    pub value: String,
    pub is_primary: bool,
}

impl RefView {
    pub fn new(id: Uuid, kind: RefKind, value: String, is_primary: bool) -> Self {
        Self {
            id,
            kind: kind.as_str().to_string(),
            value,
            is_primary,
        }
    }
}

/// Work item ref junction record
#[derive(Debug, Clone)]
pub struct WorkItemRef {
    pub work_item_id: Uuid,
    pub ref_id: Uuid,
    pub is_primary: bool,
    pub created_at: DateTime<Utc>,
}

impl WorkItemRef {
    pub fn new(work_item_id: Uuid, ref_id: Uuid, is_primary: bool) -> Self {
        Self {
            work_item_id,
            ref_id,
            is_primary,
            created_at: Utc::now(),
        }
    }
}

/// Ref conflict information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefConflict {
    pub existing_work_item_id: Uuid,
    pub existing_work_item_title: String,
    pub ref_kind: String,
    pub ref_value: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_url_normalization() {
        let result = normalize_ref_value(RefKind::Url, "HTTPS://Example.COM/path#fragment");
        assert!(result.is_ok());
        let normalized = result.unwrap();
        assert!(normalized.contains("example.com"));
        assert!(!normalized.contains("#fragment"));
    }

    #[test]
    fn test_file_path_normalization() {
        let result = normalize_ref_value(RefKind::FilePath, "C:\\Users\\test\\file.txt");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "C:/Users/test/file.txt");
    }

    #[test]
    fn test_issue_key_normalization() {
        let result = normalize_ref_value(RefKind::IssueKey, "proj-123");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), "PROJ-123");
    }

    #[test]
    fn test_empty_value_error() {
        let result = normalize_ref_value(RefKind::Custom, "  ");
        assert!(result.is_err());
    }
}
