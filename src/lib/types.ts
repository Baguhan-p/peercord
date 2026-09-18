/**
 * Shared domain types between the Rust core and the React frontend.
 * Keep in sync with `src-tauri/src/lib.rs`.
 */

/** Returned by the `start_node` Tauri command. */
export interface NodeInfo {
  peerId: string;
  displayName: string;
  signalPort: number;
}

/** Emitted on the `peer:found` event. */
export interface PeerFoundPayload {
  peerId: string;
  displayName: string;
  address: string;
  port: number;
  fullname: string;
}

/** Emitted on the `peer:lost` event. */
export interface PeerLostPayload {
  peerId: string;
  fullname: string;
}

/** Wire format for a signaling message (offer / answer / ICE candidate). */
export interface SignalEnvelope {
  from: string;
  fromName: string;
  fromSignalPort: number;
  kind: SignalKind;
  payload: unknown;
}

export type SignalKind = "description" | "ice";

/** Emitted on the `signal:incoming` event (adds the observed source IP). */
export interface IncomingSignal extends SignalEnvelope {
  addr: string;
}

/** Lifecycle of a single peer connection. */
export type LinkState =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";

/** Frontend-side view of a peer. */
export interface PeerRecord {
  peerId: string;
  displayName: string;
  address: string;
  port: number;
  state: LinkState;
  rttMs: number | null;
  lastSeen: number;
  /** true when this instance initiates the offer (selfId < peerId). */
  initiator: boolean;
}

export type LogLevel = "info" | "net" | "warn" | "error";

export interface LogEntry {
  id: string;
  ts: number;
  level: LogLevel;
  text: string;
}
