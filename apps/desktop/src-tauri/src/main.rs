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
    AppHandle, Manager, RunEvent, Runtime, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
use timeskein_agent::{
    api::create_router,
    db::Database,
    domain::{AppEvent, AppEventKind, AppEventSource},
    runtime::{ensure_data_dir, read_port_file, write_port_file, SingleInstanceLock},
    AppState,
};
use tokio::sync::RwLock;

use chrono::{Datelike, Duration as ChronoDuration, Local, TimeZone};
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
    set_tray_status_title_value(&app, title.as_deref())
}

fn set_tray_status_title_value<R: Runtime>(
    app: &AppHandle<R>,
    title: Option<&str>,
) -> Result<(), String> {
    let Some(tray) = app.tray_by_id("main") else {
        return Ok(());
    };

    let title = title.map(str::trim).filter(|value| !value.is_empty());
    let tooltip = title
        .as_ref()
        .map(|value| format!("Timeskein: {value}"))
        .unwrap_or_else(|| "Timeskein: нет фокуса".to_string());

    tray.set_title(title).map_err(|error| error.to_string())?;
    tray.set_tooltip(Some(tooltip))
        .map_err(|error| error.to_string())?;

    Ok(())
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>, control: &'static str) {
    if let Some(window) = app.get_webview_window("main") {
        log_native_window_request(app, AppEventKind::WindowShowRequested, control);
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_main_window<R: Runtime>(app: &AppHandle<R>, control: &'static str) {
    if let Some(window) = app.get_webview_window("main") {
        log_native_window_request(app, AppEventKind::WindowHideRequested, control);
        let _ = window.hide();
    }
}

fn toggle_main_window<R: Runtime>(app: &AppHandle<R>, control: &'static str) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            log_native_window_request(app, AppEventKind::WindowHideRequested, control);
            let _ = window.hide();
        } else {
            show_main_window(app, control);
        }
    }
}

fn log_native_window_request<R: Runtime>(
    app: &AppHandle<R>,
    kind: AppEventKind,
    control: &'static str,
) {
    let api_url = app.state::<AgentRuntime>().api_url.clone();
    let Some(port) = parse_local_api_port(&api_url) else {
        return;
    };

    tauri::async_runtime::spawn(async move {
        let body = serde_json::json!({
            "version": "1.0",
            "request_id": format!("native-window-{}-{control}", kind.as_str()),
            "method": "app_event.log",
            "params": {
                "source": "ui",
                "kind": kind.as_str(),
                "payload": {
                    "control": control
                }
            }
        })
        .to_string();
        let _ = send_local_api_request(port, &body).await;
    });
}

fn start_tray_status_updater<R: Runtime>(app: AppHandle<R>, api_url: String) {
    let Some(port) = parse_local_api_port(&api_url) else {
        return;
    };

    tauri::async_runtime::spawn(async move {
        loop {
            if let Ok(title) = fetch_tray_focus_title(port).await {
                let _ = set_tray_status_title_value(&app, title.as_deref());
            }

            time::sleep(Duration::from_secs(15)).await;
        }
    });
}

fn parse_local_api_port(api_url: &str) -> Option<u16> {
    let value = api_url.strip_prefix("http://127.0.0.1:")?;
    let port = value.split('/').next()?;
    port.parse().ok()
}

async fn fetch_tray_focus_title(port: u16) -> anyhow::Result<Option<String>> {
    let body =
        r#"{"version":"1.0","request_id":"tray-status","method":"focus.current","params":{}}"#;
    let response = send_local_api_request(port, body).await?;
    let body = response
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .unwrap_or(response.as_str());
    let value: serde_json::Value = serde_json::from_str(body)?;
    let Some(session) = value.pointer("/result/session") else {
        return Ok(None);
    };
    if session.is_null() {
        return fetch_tray_day_title(port).await;
    }
    if session.get("state").and_then(|value| value.as_str()) != Some("active") {
        return fetch_tray_day_title(port).await;
    }

    let active_seconds = session
        .get("active_seconds")
        .and_then(|value| value.as_i64())
        .unwrap_or(0);
    let over_target_seconds = session
        .get("over_target_seconds")
        .and_then(|value| value.as_i64())
        .unwrap_or(0);
    let active = format_tray_duration(active_seconds);
    if over_target_seconds > 0 {
        return Ok(Some(format!(
            "{active} в фокусе +{}",
            format_tray_duration(over_target_seconds)
        )));
    }

    Ok(Some(format!("{active} в фокусе")))
}

async fn fetch_tray_day_title(port: u16) -> anyhow::Result<Option<String>> {
    let Some((from, to)) = local_day_window_rfc3339() else {
        return Ok(None);
    };
    let body = format!(
        r#"{{"version":"1.0","request_id":"tray-day-status","method":"focus.list","params":{{"from":"{from}","to":"{to}"}}}}"#
    );
    let response = send_local_api_request(port, &body).await?;
    let body = response
        .split_once("\r\n\r\n")
        .map(|(_, body)| body)
        .unwrap_or(response.as_str());
    let value: serde_json::Value = serde_json::from_str(body)?;
    let active_seconds_total = value
        .pointer("/result/active_seconds_total")
        .and_then(|value| value.as_i64())
        .unwrap_or(0);

    if active_seconds_total > 0 {
        return Ok(Some(format!(
            "{} сегодня",
            format_tray_duration(active_seconds_total)
        )));
    }

    Ok(None)
}

fn local_day_window_rfc3339() -> Option<(String, String)> {
    let now = Local::now();
    let from = Local
        .with_ymd_and_hms(now.year(), now.month(), now.day(), 0, 0, 0)
        .single()?;
    let to = from + ChronoDuration::days(1);

    Some((from.to_rfc3339(), to.to_rfc3339()))
}

async fn send_local_api_request(port: u16, body: &str) -> anyhow::Result<String> {
    let mut stream = time::timeout(
        Duration::from_millis(500),
        tokio::net::TcpStream::connect(("127.0.0.1", port)),
    )
    .await??;
    let request = format!(
        "POST /api HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );

    time::timeout(
        Duration::from_millis(500),
        stream.write_all(request.as_bytes()),
    )
    .await??;

    let mut response = String::new();
    time::timeout(
        Duration::from_millis(750),
        stream.read_to_string(&mut response),
    )
    .await??;

    Ok(response)
}

fn format_tray_duration(total_seconds: i64) -> String {
    let minutes = (total_seconds.max(0) / 60).max(0);
    if minutes < 60 {
        return format!("{minutes} мин");
    }

    let hours = minutes / 60;
    let rest = minutes % 60;
    if rest == 0 {
        format!("{hours} ч")
    } else {
        format!("{hours} ч {rest} мин")
    }
}

async fn start_embedded_agent() -> anyhow::Result<AgentRuntime> {
    let data_dir = ensure_data_dir()?;
    let mut stale_runtime_recovered = false;
    let lock = match SingleInstanceLock::acquire(&data_dir) {
        Ok(lock) => Some(lock),
        Err(error) => {
            if let Some(port) = read_port_file(&data_dir)? {
                if existing_agent_is_responsive(port).await {
                    eprintln!("Using existing Timeskein agent from port file: {port}");
                    log_existing_agent_event(port, AppEventKind::AgentReused).await;
                    return Ok(AgentRuntime {
                        api_url: format!("http://127.0.0.1:{port}/api"),
                        _lock: None,
                    });
                }

                eprintln!(
                    "Ignoring stale Timeskein agent lock/port after failed lock acquire: {error}"
                );
                cleanup_agent_runtime_files(&data_dir);
                stale_runtime_recovered = true;
                Some(SingleInstanceLock::acquire(&data_dir)?)
            } else {
                return Err(error);
            }
        }
    };

    let db_path = data_dir.join("timeskein.db");
    let db = Database::new(&db_path).await?;
    if stale_runtime_recovered {
        log_db_agent_event(&db, AppEventKind::AgentStaleRuntimeRecovered, None).await;
    }
    log_db_agent_event(&db, AppEventKind::AgentStarted, None).await;
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

    if time::timeout(
        Duration::from_millis(500),
        stream.write_all(request.as_bytes()),
    )
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

async fn log_existing_agent_event(port: u16, kind: AppEventKind) {
    let body = format!(
        r#"{{"version":"1.0","request_id":"startup-event","method":"app_event.log","params":{{"source":"agent","kind":"{}"}}}}"#,
        kind.as_str()
    );
    let request = format!(
        "POST /api HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );

    let Ok(Ok(mut stream)) = time::timeout(
        Duration::from_millis(500),
        tokio::net::TcpStream::connect(("127.0.0.1", port)),
    )
    .await
    else {
        return;
    };

    let _ = time::timeout(
        Duration::from_millis(500),
        stream.write_all(request.as_bytes()),
    )
    .await;
}

async fn log_db_agent_event(db: &Database, kind: AppEventKind, payload: Option<serde_json::Value>) {
    let mut event = AppEvent::new(AppEventSource::Agent, kind);
    event.payload = payload;
    let _ = db.log_app_event(&event).await;
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
        .invoke_handler(tauri::generate_handler![get_api_url, set_tray_status_title])
        .setup(|app| {
            let agent = tauri::async_runtime::block_on(start_embedded_agent())?;
            let api_url = agent.api_url.clone();
            app.manage(agent);

            // Create tray menu
            let quit = MenuItem::with_id(app, "quit", "Выйти", true, None::<&str>)?;
            let toggle = MenuItem::with_id(
                app,
                "toggle",
                "Показать/скрыть Timeskein",
                true,
                None::<&str>,
            )?;

            let menu = Menu::with_items(app, &[&toggle, &quit])?;

            // Create tray icon
            let _tray = TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Timeskein: нет фокуса")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "toggle" => {
                        toggle_main_window(app, "tray_menu");
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
                        toggle_main_window(app, "tray_click");
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
                        toggle_main_window(app, "global_shortcut");
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

            start_tray_status_updater(app.handle().clone(), api_url);

            Ok(())
        })
        .on_window_event(|window, event| {
            // Hide window instead of closing on ESC or close button
            if let WindowEvent::CloseRequested { api, .. } = event {
                hide_main_window(window.app_handle(), "close_request");
                api.prevent_close();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::Reopen {
                has_visible_windows,
                ..
            } = event
            {
                if !has_visible_windows {
                    show_main_window(app, "macos_reopen");
                }
            }
        });
}
