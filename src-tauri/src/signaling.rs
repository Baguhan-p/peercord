//! Minimal LAN signaling transport.
//!
//! Each PeerCord instance listens on a random TCP port (advertised via mDNS).
//! A signaling message is a single line of JSON followed by `\n`:
//!
//! ```json
//! { "from": "<peer_id>", "fromName": "<name>", "fromSignalPort": 51234,
//!   "kind": "description" | "ice", "payload": { ... } }
//! ```
//!
//! The receiver re-emits the message to the frontend as a Tauri event,
//! enriched with the observed source IP address.

use std::net::SocketAddr;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};

/// Wire format sent between peers.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignalEnvelope {
    pub from: String,
    pub from_name: String,
    pub from_signal_port: u16,
    /// "description" | "ice"
    pub kind: String,
    pub payload: serde_json::Value,
}

/// Payload emitted to the frontend on `signal:incoming`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct IncomingSignal {
    from: String,
    from_name: String,
    from_signal_port: u16,
    kind: String,
    payload: serde_json::Value,
    /// IP observed on the TCP connection (authoritative for the reply).
    addr: String,
}

/// Binds an ephemeral TCP port and spawns the accept loop.
///
/// Returns the chosen port so it can be published in the mDNS TXT record.
pub fn start_listener(app: AppHandle) -> Result<u16, String> {
    let std_listener = std::net::TcpListener::bind("0.0.0.0:0")
        .map_err(|e| format!("failed to bind signaling socket: {e}"))?;

    std_listener
        .set_nonblocking(true)
        .map_err(|e| format!("failed to set nonblocking: {e}"))?;

    let port = std_listener
        .local_addr()
        .map_err(|e| format!("failed to read local addr: {e}"))?
        .port();

    tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::from_std(std_listener) {
            Ok(l) => l,
            Err(e) => {
                log::error!("signaling: could not adopt listener: {e}");
                return;
            }
        };

        log::info!("signaling listener ready on 0.0.0.0:{port}");

        loop {
            match listener.accept().await {
                Ok((socket, addr)) => {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = handle_connection(socket, addr, app).await {
                            log::debug!("signaling: connection {addr} ended: {e}");
                        }
                    });
                }
                Err(e) => {
                    log::warn!("signaling: accept error: {e}");
                    tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                }
            }
        }
    });

    Ok(port)
}

/// Reads newline-delimited JSON messages until the peer disconnects.
async fn handle_connection(
    socket: TcpStream,
    addr: SocketAddr,
    app: AppHandle,
) -> std::io::Result<()> {
    let mut reader = BufReader::new(socket);
    let mut line = String::new();

    loop {
        line.clear();
        let read = reader.read_line(&mut line).await?;
        if read == 0 {
            break;
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        match serde_json::from_str::<SignalEnvelope>(trimmed) {
            Ok(envelope) => {
                let event = IncomingSignal {
                    from: envelope.from,
                    from_name: envelope.from_name,
                    from_signal_port: envelope.from_signal_port,
                    kind: envelope.kind,
                    payload: envelope.payload,
                    addr: addr.ip().to_string(),
                };

                if let Err(e) = app.emit("signal:incoming", event) {
                    log::warn!("signaling: emit failed: {e}");
                }
            }
            Err(e) => {
                log::warn!("signaling: malformed message from {addr}: {e}");
            }
        }
    }

    Ok(())
}

/// Opens a short-lived TCP connection to a peer and writes one JSON line.
pub async fn send_signal(
    addr: &str,
    port: u16,
    envelope: &SignalEnvelope,
) -> Result<(), String> {
    let mut stream = TcpStream::connect((addr, port))
        .await
        .map_err(|e| format!("connect {addr}:{port} failed: {e}"))?;

    let mut body = serde_json::to_vec(envelope)
        .map_err(|e| format!("serialize envelope failed: {e}"))?;
    body.push(b'\n');

    stream
        .write_all(&body)
        .await
        .map_err(|e| format!("write failed: {e}"))?;

    stream
        .flush()
        .await
        .map_err(|e| format!("flush failed: {e}"))?;

    // Half-close so the receiver's read loop terminates promptly.
    let _ = stream.shutdown().await;

    Ok(())
}
