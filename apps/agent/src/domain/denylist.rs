//! Denylist policy logic

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Denylist policy type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(rename_all = "snake_case")]
pub enum DenylistPolicy {
    Block,
    RedactToDomain,
}

impl DenylistPolicy {
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "block" => Some(Self::Block),
            "redact_to_domain" => Some(Self::RedactToDomain),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Block => "block",
            Self::RedactToDomain => "redact_to_domain",
        }
    }
}

/// Denylist rule entity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DenylistRule {
    pub id: Uuid,
    pub pattern: String,
    pub policy: DenylistPolicy,
    pub created_at: DateTime<Utc>,
}

impl DenylistRule {
    pub fn new(pattern: String, policy: DenylistPolicy) -> Self {
        Self {
            id: Uuid::new_v4(),
            pattern,
            policy,
            created_at: Utc::now(),
        }
    }

    /// Check if a URL matches this rule's pattern
    pub fn matches(&self, url: &str) -> bool {
        let url_lower = url.to_lowercase();
        let pattern_lower = self.pattern.to_lowercase();

        // Simple pattern matching:
        // - Exact match
        // - Wildcard prefix (*.example.com)
        // - Contains match (example.com)

        if pattern_lower.starts_with("*.") {
            // Wildcard pattern: *.example.com matches sub.example.com
            let suffix = &pattern_lower[1..]; // .example.com
            url_lower.contains(suffix)
        } else {
            // Exact or contains match
            url_lower.contains(&pattern_lower)
        }
    }

    /// Redact a URL to just domain
    pub fn redact_to_domain(url: &str) -> String {
        if let Ok(parsed) = url::Url::parse(url) {
            if let Some(host) = parsed.host_str() {
                return format!("domain:{}", host);
            }
        }
        // Fallback: just use the original
        format!("redacted:{}", url.chars().take(20).collect::<String>())
    }
}

/// Denylist view for API responses
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DenylistRuleView {
    pub id: Uuid,
    pub pattern: String,
    pub policy: String,
    pub created_at: String,
}

impl From<&DenylistRule> for DenylistRuleView {
    fn from(rule: &DenylistRule) -> Self {
        Self {
            id: rule.id,
            pattern: rule.pattern.clone(),
            policy: rule.policy.as_str().to_string(),
            created_at: rule.created_at.to_rfc3339(),
        }
    }
}

/// Result of checking a URL against denylist
#[derive(Debug, Clone)]
pub enum DenylistCheckResult {
    /// URL is allowed
    Allowed,
    /// URL is blocked
    Blocked { rule_id: Uuid, pattern: String },
    /// URL should be redacted to domain only
    Redact {
        rule_id: Uuid,
        pattern: String,
        redacted_value: String,
    },
}

/// Check a URL against a list of denylist rules
pub fn check_denylist(url: &str, rules: &[DenylistRule]) -> DenylistCheckResult {
    for rule in rules {
        if rule.matches(url) {
            match rule.policy {
                DenylistPolicy::Block => {
                    return DenylistCheckResult::Blocked {
                        rule_id: rule.id,
                        pattern: rule.pattern.clone(),
                    };
                }
                DenylistPolicy::RedactToDomain => {
                    return DenylistCheckResult::Redact {
                        rule_id: rule.id,
                        pattern: rule.pattern.clone(),
                        redacted_value: DenylistRule::redact_to_domain(url),
                    };
                }
            }
        }
    }
    DenylistCheckResult::Allowed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_exact_match() {
        let rule = DenylistRule::new("mail.google.com".to_string(), DenylistPolicy::Block);
        assert!(rule.matches("https://mail.google.com/inbox"));
        assert!(!rule.matches("https://google.com"));
    }

    #[test]
    fn test_wildcard_match() {
        let rule = DenylistRule::new("*.internal.company.com".to_string(), DenylistPolicy::Block);
        assert!(rule.matches("https://app.internal.company.com/page"));
        assert!(rule.matches("https://test.internal.company.com"));
        assert!(!rule.matches("https://company.com"));
    }

    #[test]
    fn test_redact_to_domain() {
        let redacted =
            DenylistRule::redact_to_domain("https://secret.example.com/path?query=value");
        assert_eq!(redacted, "domain:secret.example.com");
    }

    #[test]
    fn test_check_denylist_blocked() {
        let rules = vec![DenylistRule::new(
            "mail.google.com".to_string(),
            DenylistPolicy::Block,
        )];

        let result = check_denylist("https://mail.google.com/inbox", &rules);
        assert!(matches!(result, DenylistCheckResult::Blocked { .. }));
    }

    #[test]
    fn test_check_denylist_allowed() {
        let rules = vec![DenylistRule::new(
            "mail.google.com".to_string(),
            DenylistPolicy::Block,
        )];

        let result = check_denylist("https://github.com", &rules);
        assert!(matches!(result, DenylistCheckResult::Allowed));
    }
}
