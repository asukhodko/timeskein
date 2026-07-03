//! Database module - SQLite persistence layer

mod app_events;
mod captures;
mod connection;
mod day_events;
mod focus_sessions;
mod refs;
mod settings;
mod work_items;

pub use connection::Database;
