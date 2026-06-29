//! Settings repository

use anyhow::Result;
use sqlx::Row;
use uuid::Uuid;

use crate::db::Database;
use crate::domain::{DenylistRule, DenylistPolicy};

impl Database {
    /// Get a setting value
    pub async fn get_setting(&self, key: &str) -> Result<Option<String>> {
        let row = sqlx::query("SELECT value FROM settings WHERE key = ?1")
            .bind(key)
            .fetch_optional(self.pool())
            .await?;

        Ok(row.map(|r| r.get("value")))
    }

    /// Set a setting value
    pub async fn set_setting(&self, key: &str, value: &str) -> Result<()> {
        sqlx::query(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = ?2"
        )
        .bind(key)
        .bind(value)
        .execute(self.pool())
        .await?;

        Ok(())
    }

    /// Get all settings as JSON object
    pub async fn get_all_settings(&self) -> Result<serde_json::Value> {
        let rows = sqlx::query("SELECT key, value FROM settings")
            .fetch_all(self.pool())
            .await?;

        let mut settings = serde_json::Map::new();
        for row in rows {
            let key: String = row.get("key");
            let value: String = row.get("value");
            // Try to parse as JSON, otherwise use as string
            let json_value = serde_json::from_str(&value).unwrap_or_else(|_| serde_json::Value::String(value));
            settings.insert(key, json_value);
        }

        Ok(serde_json::Value::Object(settings))
    }

    /// Get all denylist rules
    pub async fn get_denylist(&self) -> Result<Vec<DenylistRule>> {
        let rows = sqlx::query("SELECT id, pattern, policy, created_at FROM denylist_rules ORDER BY created_at DESC")
            .fetch_all(self.pool())
            .await?;

        let mut rules = Vec::new();
        for row in rows {
            let id_str: String = row.get("id");
            let id = Uuid::parse_str(&id_str)?;
            let policy_str: String = row.get("policy");
            let policy = DenylistPolicy::from_str(&policy_str).unwrap_or(DenylistPolicy::Block);
            let created_at_str: String = row.get("created_at");
            let created_at = chrono::DateTime::parse_from_rfc3339(&created_at_str)?
                .with_timezone(&chrono::Utc);

            rules.push(DenylistRule {
                id,
                pattern: row.get("pattern"),
                policy,
                created_at,
            });
        }

        Ok(rules)
    }

    /// Add a denylist rule
    pub async fn add_denylist_rule(&self, rule: &DenylistRule) -> Result<()> {
        sqlx::query(
            "INSERT INTO denylist_rules (id, pattern, policy, created_at)
             VALUES (?1, ?2, ?3, ?4)"
        )
        .bind(rule.id.to_string())
        .bind(&rule.pattern)
        .bind(rule.policy.as_str())
        .bind(rule.created_at.to_rfc3339())
        .execute(self.pool())
        .await?;

        Ok(())
    }

    /// Remove a denylist rule
    pub async fn remove_denylist_rule(&self, id: Uuid) -> Result<bool> {
        let result = sqlx::query("DELETE FROM denylist_rules WHERE id = ?1")
            .bind(id.to_string())
            .execute(self.pool())
            .await?;

        Ok(result.rows_affected() > 0)
    }
}
