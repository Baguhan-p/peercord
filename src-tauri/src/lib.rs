//! PeerCord core — Phase 1: skeleton, mDNS discovery, TCP signaling.
//!
//! Exposed Tauri commands:
//!   • `start_node(peerId, displayName)` → boots mDNS + signaling listener
//!   • `stop_node()`                     → tears everything down
//!   • `get_node_info()`                 → current identity / port
//!   • `send_signal(addr, port, message)`→ relays one signaling envelope
//!
//! Emitted Tauri events:
//!   • `peer:found`      — a peer appeared on the LAN
//!   • `peer:lost`       — a peer disappeared
//!   • `signal:incoming` — an SDP/ICE envelope arrived

mod discovery;
mod signaling;

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use discovery::DiscoveryService;
use signaling::SignalEnvelope;

/// Process-wide node state, guarded by a mutex.
#[derive(Default)]
pub struct NodeState {
    discovery: Mutex<Option<DiscoveryService>>,
    peer_id: Mutex<Option<String>>,
    display_name: Mutex<Option<String>>,
    signal_port: Mutex<Option<u16>>,
}

/// Public node descriptor returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInfo {
    pub peer_id: String,
    pub display_name: String,
    pub signal_port: u16,
}

/// Boots the node: binds the signaling listener, registers mDNS, starts browsing.
#[tauri::command]
async fn start_node(
    app: AppHandle,
    state: State<'_, NodeState>,
    peer_id: String,
    display_name: String,
) -> Result<NodeInfo, String> {
    // Idempotent: tear down any previous incarnation first.
    {
        let mut guard = state.discovery.lock().map_err(|_| "state poisoned")?;
        if let Some(existing) = guard.take() {
            existing.shutdown();
        }
    }

    let port = signaling::start_listener(app.clone())?;

    let service = DiscoveryService::start(
        peer_id.clone(),
        display_name.clone(),
        port,
        app.clone(),
    )?;

    *state.discovery.lock().map_err(|_| "state poisoned")? = Some(service);
    *state.peer_id.lock().map_err(|_| "state poisoned")? = Some(peer_id.clone());
    *state.display_name.lock().map_err(|_| "state poisoned")? = Some(display_name.clone());
    *state.signal_port.lock().map_err(|_| "state poisoned")? = Some(port);

    log::info!("node started: {display_name} ({peer_id}) on port {port}");

    Ok(NodeInfo {
        peer_id,
        display_name,
        signal_port: port,
    })
}

/// Tears down mDNS + signaling and clears identity.
#[tauri::command]
fn stop_node(state: State<'_, NodeState>) -> Result<(), String> {
    let mut guard = state.discovery.lock().map_err(|_| "state poisoned")?;
    if let Some(service) = guard.take() {
        service.shutdown();
    }
    *state.peer_id.lock().map_err(|_| "state poisoned")? = None;
    *state.display_name.lock().map_err(|_| "state poisoned")? = None;
    *state.signal_port.lock().map_err(|_| "state poisoned")? = None;
    Ok(())
}

/// Returns the current node descriptor, or `None` when the node is stopped.
#[tauri::command]
fn get_node_info(state: State<'_, NodeState>) -> Result<Option<NodeInfo>, String> {
    let peer_id = state.peer_id.lock().map_err(|_| "state poisoned")?.clone();
    let display_name = state
        .display_name
        .lock()
        .map_err(|_| "state poisoned")?
        .clone();
    let signal_port = *state.signal_port.lock().map_err(|_| "state poisoned")?;

    match (peer_id, display_name, signal_port) {
        (Some(peer_id), Some(display_name), Some(signal_port)) => Ok(Some(NodeInfo {
            peer_id,
            display_name,
            signal_port,
        })),
        _ => Ok(None),
    }
}

/// Delivers one signaling envelope to a remote peer over TCP.
#[tauri::command]
async fn send_signal(
    addr: String,
    port: u16,
    message: SignalEnvelope,
) -> Result<(), String> {
    signaling::send_signal(&addr, port, &message).await
}

/// Application entry point.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(NodeState::default())
        .invoke_handler(tauri::generate_handler![
            start_node,
            stop_node,
            get_node_info,
            send_signal,
        ])
        .setup(|_app| {
            #[cfg(debug_assertions)]
            {
                let _ = env_logger_init();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running PeerCord");
}

#[cfg(debug_assertions)]
fn env_logger_init() -> Result<(), Box<dyn std::error::Error>> {
    // Lightweight fallback: Tauri's default logger is enough for Phase 1.
    // Replace with `env_logger` / `tauri-plugin-log` when log routing lands.
    Ok(())
}
