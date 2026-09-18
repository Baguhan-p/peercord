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

/* ================================================================== */
/* Phase 2 — Chat                                                      */
/* ================================================================== */

/** Channels that carry a persistent CRDT chat log. */
export const CHAT_CHANNELS = ["general", "media"] as const;
export type TextChannelId = (typeof CHAT_CHANNELS)[number];

export function isChatChannel(id: string): id is TextChannelId {
  return (CHAT_CHANNELS as readonly string[]).includes(id);
}

/** A single chat message as stored in the Yjs document. */
export interface ChatMessage {
  id: string;
  channel: TextChannelId;
  /** Stable peer id of the author (16-hex-char). */
  author: string;
  authorName: string;
  text: string;
  ts: number;
}

/**
 * Yjs sync frames multiplexed over the existing WebRTC DataChannel.
 *
 *   sync1 — our state vector (what we already have)
 *   sync2 — diff computed against the remote's state vector
 *   update — incremental local change
 *
 * Binary payloads are base64-encoded so the frames stay valid UTF-8 JSON
 * and reuse the existing text-mode DataChannel.
 */
export type YjsFrame =
  | { t: "yjs"; ch: TextChannelId; k: "sync1"; sv: string }
  | { t: "yjs"; ch: TextChannelId; k: "sync2"; diff: string }
  | { t: "yjs"; ch: TextChannelId; k: "update"; u: string };
