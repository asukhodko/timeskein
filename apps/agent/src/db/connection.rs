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
        db.normalize_active_work_items_for_focus().await?;

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
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='work_items')",
        )
        .fetch_one(&self.pool)
        .await?;

        if !tables_exist {
            info!("Running initial migration...");

            let migration_sql = include_str!("../../migrations/001_initial.sql");
            sqlx::raw_sql(migration_sql).execute(&self.pool).await?;

            info!("Migration completed successfully");
        } else {
            info!("Database schema already exists");
        }

        let focus_sessions_sql = include_str!("../../migrations/002_focus_sessions.sql");
        sqlx::raw_sql(focus_sessions_sql)
            .execute(&self.pool)
            .await?;

        let app_events_sql = include_str!("../../migrations/003_app_events.sql");
        sqlx::raw_sql(app_events_sql).execute(&self.pool).await?;
        self.ensure_app_events_current_kinds().await?;

        let captures_sql = include_str!("../../migrations/004_captures.sql");
        sqlx::raw_sql(captures_sql).execute(&self.pool).await?;

        let day_events_sql = include_str!("../../migrations/008_day_events.sql");
        sqlx::raw_sql(day_events_sql).execute(&self.pool).await?;

        self.ensure_work_item_activity_zones().await?;
        self.ensure_work_item_note_events().await?;
        self.ensure_focus_session_activity_zones().await?;

        Ok(())
    }

    async fn ensure_focus_session_activity_zones(&self) -> Result<()> {
        let has_activity_zone = sqlx::query("PRAGMA table_info(focus_sessions)")
            .fetch_all(&self.pool)
            .await?
            .iter()
            .any(|row| {
                use sqlx::Row;
                row.get::<String, _>("name") == "activity_zone"
            });

        if !has_activity_zone {
            info!("Migrating focus_sessions activity_zone column...");
            let activity_zones_sql =
                include_str!("../../migrations/007_focus_session_activity_zones.sql");
            sqlx::raw_sql(activity_zones_sql)
                .execute(&self.pool)
                .await?;
            return Ok(());
        }

        sqlx::raw_sql(
            "
            CREATE INDEX IF NOT EXISTS idx_focus_sessions_activity_zone
                ON focus_sessions(activity_zone);
            ",
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn ensure_work_item_note_events(&self) -> Result<()> {
        let table_sql: Option<String> = sqlx::query_scalar(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='work_item_events'",
        )
        .fetch_optional(&self.pool)
        .await?;

        if table_sql
            .as_deref()
            .is_some_and(|sql| sql.contains("note_added") && sql.contains("updated"))
        {
            return Ok(());
        }

        info!("Migrating work_item_events kind constraint for timestamped notes...");
        let note_events_sql = include_str!("../../migrations/006_work_item_note_events.sql");
        sqlx::raw_sql(note_events_sql).execute(&self.pool).await?;

        Ok(())
    }

    async fn ensure_work_item_activity_zones(&self) -> Result<()> {
        let has_activity_zone = sqlx::query("PRAGMA table_info(work_items)")
            .fetch_all(&self.pool)
            .await?
            .iter()
            .any(|row| {
                use sqlx::Row;
                row.get::<String, _>("name") == "activity_zone"
            });

        if !has_activity_zone {
            info!("Migrating work_items activity_zone column...");
            let activity_zones_sql = include_str!("../../migrations/005_activity_zones.sql");
            sqlx::raw_sql(activity_zones_sql)
                .execute(&self.pool)
                .await?;
            return Ok(());
        }

        sqlx::raw_sql(
            "
            CREATE INDEX IF NOT EXISTS idx_work_items_activity_zone
                ON work_items(activity_zone)
                WHERE deleted_at IS NULL;
            ",
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn ensure_app_events_current_kinds(&self) -> Result<()> {
        let table_sql: Option<String> = sqlx::query_scalar(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='app_events'",
        )
        .fetch_optional(&self.pool)
        .await?;

        if table_sql
            .as_deref()
            .is_some_and(|sql| sql.contains("work_item_time_badges_reviewed"))
        {
            return Ok(());
        }

        info!("Migrating app_events kind constraint for current telemetry...");

        sqlx::raw_sql(
            "
            PRAGMA foreign_keys=OFF;
            ALTER TABLE app_events RENAME TO app_events_old;
            DROP INDEX IF EXISTS idx_app_events_ts;
            DROP INDEX IF EXISTS idx_app_events_kind;
            DROP INDEX IF EXISTS idx_app_events_work_item;
            DROP INDEX IF EXISTS idx_app_events_focus_session;
            ",
        )
        .execute(&self.pool)
        .await?;

        let app_events_sql = include_str!("../../migrations/003_app_events.sql");
        sqlx::raw_sql(app_events_sql).execute(&self.pool).await?;

        sqlx::raw_sql(
            "
            INSERT INTO app_events (id, ts, source, kind, work_item_id, focus_session_id, payload)
            SELECT id, ts, source, kind, work_item_id, focus_session_id, payload
            FROM app_events_old;
            DROP TABLE app_events_old;
            PRAGMA foreign_keys=ON;
            ",
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Check database health
    pub async fn is_healthy(&self) -> bool {
        sqlx::query("SELECT 1").execute(&self.pool).await.is_ok()
    }
}
