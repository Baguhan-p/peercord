//! Zero-configuration LAN peer discovery via mDNS / DNS-SD.
//!
//! Each instance registers `_peercord._tcp.local.` with TXT records:
//!   • `peer_id` — stable random identity of this instance
//!   • `name`    — human-readable display name
//!   • `port`    — TCP port of the signaling listener
//!
//! Resolved / removed services are re-emitted to the frontend as
//! `peer:found` and `peer:lost` events.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::thread;

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

pub const SERVICE_TYPE: &str = "_peercord._tcp.local.";

/// Emitted on `peer:found`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerFoundPayload {
    pub peer_id: String,
    pub display_name: String,
    pub address: String,
    pub port: u16,
    pub fullname: String,
}

/// Emitted on `peer:lost`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerLostPayload {
    pub peer_id: String,
    pub fullname: String,
}

/// Owns the mDNS daemon and the browse thread.
pub struct DiscoveryService {
    daemon: ServiceDaemon,
    fullname: String,
    /// fullname -> peer_id, so `ServiceRemoved` can be mapped back.
    seen: Arc<Mutex<HashMap<String, String>>>,
}

impl DiscoveryService {
    /// Registers our service and starts browsing for peers.
    pub fn start(
        peer_id: String,
        display_name: String,
        signal_port: u16,
        app: AppHandle,
    ) -> Result<Self, String> {
        let daemon = ServiceDaemon::new().map_err(|e| format!("mdns daemon: {e}"))?;

        // Prefer a real LAN IPv4 address so peers on other hosts can reach us.
        let ip: IpAddr = local_ip_address::local_ip()
            .unwrap_or(IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1)));

        let host_label = sanitize_label(&format!("peercord-{peer_id}"));
        let host_name = format!("{host_label}.local.");
        let instance_name = format!("PeerCord {peer_id}");

        let port_str = signal_port.to_string();
        let properties = [
            ("peer_id", peer_id.as_str()),
            ("name", display_name.as_str()),
            ("port", port_str.as_str()),
        ];

        let service = ServiceInfo::new(
            SERVICE_TYPE,
            &instance_name,
            &host_name,
            ip,
            signal_port,
            &properties[..],
        )
        .map_err(|e| format!("ServiceInfo::new: {e}"))?
        .enable_addr_auto();

        let fullname = service.get_fullname().to_string();

        daemon
            .register(service)
            .map_err(|e| format!("mdns register: {e}"))?;

        log::info!("mDNS registered {fullname} at {ip}:{signal_port}");

        let seen: Arc<Mutex<HashMap<String, String>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let seen_thread = Arc::clone(&seen);

        let receiver = daemon
            .browse(SERVICE_TYPE)
            .map_err(|e| format!("mdns browse: {e}"))?;

        let self_id = peer_id.clone();

        thread::spawn(move || {
            while let Ok(event) = receiver.recv() {
                match event {
                    ServiceEvent::ServiceResolved(info) => {
                        let Some(remote_id) = info.get_property_val_str("peer_id") else {
                            continue;
                        };

                        // Ignore our own advertisement.
                        if remote_id == self_id {
                            continue;
                        }

                        let remote_id = remote_id.to_string();
                        let display_name = info
                            .get_property_val_str("name")
                            .unwrap_or("Unknown peer")
                            .to_string();

                        let port = info
                            .get_property_val_str("port")
                            .and_then(|p| p.parse::<u16>().ok())
                            .unwrap_or(0);

                        if port == 0 {
                            log::warn!("peer {remote_id} advertised port 0 — skipping");
                            continue;
                        }

                        let Some(address) = pick_address(&info) else {
                            log::debug!("peer {remote_id} has no usable address yet — waiting");
                            continue;
                        };
                        let fullname = info.get_fullname().to_string();

                        if let Ok(mut map) = seen_thread.lock() {
                            map.insert(fullname.clone(), remote_id.clone());
                        }

                        let payload = PeerFoundPayload {
                            peer_id: remote_id,
                            display_name,
                            address,
                            port,
                            fullname,
                        };

                        if let Err(e) = app.emit("peer:found", payload) {
                            log::warn!("emit peer:found failed: {e}");
                        }
                    }

                    ServiceEvent::ServiceRemoved(_ty, fullname) => {
                        let peer_id = seen_thread
                            .lock()
                            .ok()
                            .and_then(|mut map| map.remove(&fullname))
                            .unwrap_or_default();

                        if peer_id.is_empty() {
                            continue;
                        }

                        let payload = PeerLostPayload {
                            peer_id,
                            fullname,
                        };

                        if let Err(e) = app.emit("peer:lost", payload) {
                            log::warn!("emit peer:lost failed: {e}");
                        }
                    }

                    _ => { /* ServiceFound / SearchStarted / SearchStopped */ }
                }
            }

            log::debug!("mdns browse thread finished");
        });

        Ok(Self {
            daemon,
            fullname,
            seen,
        })
    }

    /// Unregisters the service and shuts down the daemon.
    pub fn shutdown(&self) {
        let _ = self.daemon.unregister(&self.fullname);
        let _ = self.daemon.shutdown();
        if let Ok(mut map) = self.seen.lock() {
            map.clear();
        }
    }
}

/// Prefer IPv4 — some platforms advertise link-local IPv6 first, which peers
/// on the same LAN cannot always dial without a scope id.
/// Prefer IPv4 global, then any IPv4, then global IPv6.
/// Link-local IPv6 (fe80::) is useless without a scope id — skip it.
fn pick_address(info: &ServiceInfo) -> Option<String> {
    let addrs = info.get_addresses();

    if let Some(ip) = addrs.iter().find(|ip| match ip {
        IpAddr::V4(v4) => {
            !v4.is_link_local() && !v4.is_loopback() && !v4.is_unspecified()
        }
        _ => false,
    }) {
        return Some(ip.to_string());
    }

    if let Some(ip) = addrs.iter().find(|ip| ip.is_ipv4()) {
        return Some(ip.to_string());
    }

    if let Some(ip) = addrs.iter().find(|ip| match ip {
        IpAddr::V6(v6) => {
            !v6.is_loopback()
                && !v6.is_unspecified()
                && (v6.segments()[0] & 0xffc0) != 0xfe80
        }
        _ => false,
    }) {
        return Some(ip.to_string());
    }

    None
}

/// mDNS instance/host labels must not contain dots or spaces.
fn sanitize_label(input: &str) -> String {
    input
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect()
}
