//! Database connection and initialization

use std::path::Path;

use anyhow::Result;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Pool, Sqlite};
use tracing::info;

/// Database wrapper
#[derive(Clone)]
pub struct Database {
    pool: Pool<Sqlite>,
}

impl Database {
    /// Create a new database connection
    pub async fn new(path: &Path) -> Result<Self> {
        let path_str = path.to_string_lossy();
        
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .foreign_keys(true)
            .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;

        info!("Connected to database: {}", path_str);

        let db = Self { pool };
        db.run_migrations().await?;

        Ok(db)
    }

    /// Get the connection pool
    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    /// Run database migrations
    async fn run_migrations(&self) -> Result<()> {
        // Check if tables exist
        let tables_exist: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='work_items')"
        )
        .fetch_one(&self.pool)
        .await?;

        if !tables_exist {
            info!("Running initial migration...");
            
            // Run the initial migration
            let migration_sql = include_str!("../../migrations/001_initial.sql");
            
            // Split by semicolon and execute each statement
            for statement in migration_sql.split(';') {
                let trimmed = statement.trim();
                if !trimmed.is_empty() && !trimmed.starts_with("--") {
                    sqlx::query(trimmed)
                        .execute(&self.pool)
                        .await?;
                }
            }
            
            info!("Migration completed successfully");
        } else {
            info!("Database schema already exists");
        }

        Ok(())
    }

    /// Check database health
    pub async fn is_healthy(&self) -> bool {
        sqlx::query("SELECT 1")
            .execute(&self.pool)
            .await
            .is_ok()
    }
}
