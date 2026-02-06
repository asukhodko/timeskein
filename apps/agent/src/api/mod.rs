//! API module - HTTP handlers and routing

mod handlers;

use std::sync::Arc;

use axum::{
    routing::post,
    Router,
};
use tokio::sync::RwLock;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use crate::AppState;

pub use handlers::*;

/// Create the API router
pub fn create_router(state: Arc<RwLock<AppState>>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/api", post(handlers::handle_rpc))
        .with_state(state)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
}
