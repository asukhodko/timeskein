//! Database module - SQLite persistence layer

mod connection;
mod focus_sessions;
mod refs;
mod settings;
mod work_items;

pub use connection::Database;
