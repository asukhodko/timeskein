//! Timeskein Desktop - Tauri Application
//!
//! Global hotkey palette + system tray for work inventory management.

#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
use timeskein_agent::{
    api::create_router,
    db::Database,
    runtime::{ensure_data_dir, read_port_file, write_port_file, SingleInstanceLock},
    AppState,
};
use tokio::sync::RwLock;

use std::{net::SocketAddr, sync::Arc};

struct AgentRuntime {
    api_url: String,
    _lock: Option<SingleInstanceLock>,
}

#[tauri::command]
fn get_api_url(agent: tauri::State<'_, AgentRuntime>) -> String {
    agent.api_url.clone()
}

fn toggle_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

async fn start_embedded_agent() -> anyhow::Result<AgentRuntime> {
    let data_dir = ensure_data_dir()?;
    let lock = match SingleInstanceLock::acquire(&data_dir) {
        Ok(lock) => Some(lock),
        Err(error) => {
            if let Some(port) = read_port_file(&data_dir)? {
                eprintln!("Using existing Timeskein agent from port file: {port}");
                return Ok(AgentRuntime {
                    api_url: format!("http://127.0.0.1:{port}/api"),
                    _lock: None,
                });
            }

            return Err(error);
        }
    };

    let db_path = data_dir.join("timeskein.db");
    let db = Database::new(&db_path).await?;
    let state = Arc::new(RwLock::new(AppState {
        db,
        start_time: std::time::Instant::now(),
    }));

    let router = create_router(state);
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0))).await?;
    let port = listener.local_addr()?.port();
    write_port_file(&data_dir, port)?;

    tauri::async_runtime::spawn(async move {
        if let Err(error) = axum::serve(listener, router).await {
            eprintln!("Embedded Timeskein agent stopped: {error}");
        }
    });

    eprintln!("Embedded Timeskein agent listening on http://127.0.0.1:{port}/api");
    Ok(AgentRuntime {
        api_url: format!("http://127.0.0.1:{port}/api"),
        _lock: lock,
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![get_api_url])
        .setup(|app| {
            let agent = tauri::async_runtime::block_on(start_embedded_agent())?;
            app.manage(agent);

            // Create tray menu
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let open = MenuItem::with_id(app, "open", "Open Inventory", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&open, &settings, &quit])?;

            // Create tray icon
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "open" => {
                        toggle_main_window(app);
                    }
                    "settings" => {
                        // TODO: Open settings window
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        toggle_main_window(app);
                    }
                })
                .build(app)?;

            let shortcut_candidates = [
                (Modifiers::CONTROL | Modifiers::SHIFT, "Ctrl+Shift+Space"),
                (Modifiers::CONTROL | Modifiers::ALT, "Ctrl+Option+Space"),
                (Modifiers::META | Modifiers::ALT, "Cmd+Option+Space"),
            ];

            let mut registered_shortcut = None;
            for (modifiers, label) in shortcut_candidates {
                let shortcut = Shortcut::new(Some(modifiers), Code::Space);
                match app
                    .global_shortcut()
                    .on_shortcut(shortcut, |app, _shortcut, _event| {
                        toggle_main_window(app);
                    }) {
                    Ok(()) => {
                        eprintln!("Registered global shortcut: {label}");
                        registered_shortcut = Some(label);
                        break;
                    }
                    Err(error) => {
                        eprintln!("Unable to register global shortcut {label}: {error}");
                    }
                }
            }

            if registered_shortcut.is_none() {
                eprintln!("Timeskein started without a global shortcut; use the tray icon/menu.");
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Hide window instead of closing on ESC or close button
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
