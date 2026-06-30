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

use std::{fs, net::SocketAddr, path::Path, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    time,
};

struct AgentRuntime {
    api_url: String,
    _lock: Option<SingleInstanceLock>,
}

#[tauri::command]
fn get_api_url(agent: tauri::State<'_, AgentRuntime>) -> String {
    agent.api_url.clone()
}

#[tauri::command]
fn set_tray_status_title(app: AppHandle, title: Option<String>) -> Result<(), String> {
    let Some(tray) = app.tray_by_id("main") else {
        return Ok(());
    };

    let title = title
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let tooltip = title
        .as_ref()
        .map(|value| format!("Timeskein: {value}"))
        .unwrap_or_else(|| "Timeskein: idle".to_string());

    tray.set_title(title.as_deref())
        .map_err(|error| error.to_string())?;
    tray.set_tooltip(Some(tooltip))
        .map_err(|error| error.to_string())?;

    Ok(())
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
                if existing_agent_is_responsive(port).await {
                    eprintln!("Using existing Timeskein agent from port file: {port}");
                    return Ok(AgentRuntime {
                        api_url: format!("http://127.0.0.1:{port}/api"),
                        _lock: None,
                    });
                }

                eprintln!(
                    "Ignoring stale Timeskein agent lock/port after failed lock acquire: {error}"
                );
                cleanup_agent_runtime_files(&data_dir);
                Some(SingleInstanceLock::acquire(&data_dir)?)
            } else {
                return Err(error);
            }
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

async fn existing_agent_is_responsive(port: u16) -> bool {
    for _ in 0..10 {
        if probe_agent_status(port).await {
            return true;
        }

        time::sleep(Duration::from_millis(150)).await;
    }

    false
}

async fn probe_agent_status(port: u16) -> bool {
    let Ok(Ok(mut stream)) = time::timeout(
        Duration::from_millis(500),
        tokio::net::TcpStream::connect(("127.0.0.1", port)),
    )
    .await
    else {
        return false;
    };

    let body =
        r#"{"version":"1.0","request_id":"startup-probe","method":"agent.status","params":{}}"#;
    let request = format!(
        "POST /api HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );

    if time::timeout(Duration::from_millis(500), stream.write_all(request.as_bytes()))
        .await
        .is_err()
    {
        return false;
    }

    let mut response = String::new();
    if time::timeout(
        Duration::from_millis(750),
        stream.read_to_string(&mut response),
    )
    .await
    .is_err()
    {
        return false;
    }

    response.starts_with("HTTP/1.1 200") && response.contains(r#""db_ok":true"#)
}

fn cleanup_agent_runtime_files(data_dir: &Path) {
    for name in ["agent.lock", "agent.port"] {
        let _ = fs::remove_file(data_dir.join(name));
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_api_url,
            set_tray_status_title
        ])
        .setup(|app| {
            let agent = tauri::async_runtime::block_on(start_embedded_agent())?;
            app.manage(agent);

            // Create tray menu
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let toggle =
                MenuItem::with_id(app, "toggle", "Show/Hide Timeskein", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&toggle, &quit])?;

            // Create tray icon
            let _tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Timeskein: idle")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "toggle" => {
                        toggle_main_window(app);
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
