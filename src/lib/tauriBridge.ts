/**
 * Thin, typed wrapper around the Tauri IPC surface.
 * Every Rust command / event used by the frontend is declared here once.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  IncomingSignal,
  NodeInfo,
  PeerFoundPayload,
  PeerLostPayload,
  SignalEnvelope,
} from "./types";

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

export const startNode = (peerId: string, displayName: string): Promise<NodeInfo> =>
  invoke<NodeInfo>("start_node", { peerId, displayName });

export const stopNode = (): Promise<void> => invoke<void>("stop_node");

export const getNodeInfo = (): Promise<NodeInfo | null> =>
  invoke<NodeInfo | null>("get_node_info");

export const sendSignal = (
  addr: string,
  port: number,
  message: SignalEnvelope,
): Promise<void> => invoke<void>("send_signal", { addr, port, message });

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

export const onPeerFound = (
  cb: (p: PeerFoundPayload) => void,
): Promise<UnlistenFn> => listen<PeerFoundPayload>("peer:found", (e) => cb(e.payload));

export const onPeerLost = (
  cb: (p: PeerLostPayload) => void,
): Promise<UnlistenFn> => listen<PeerLostPayload>("peer:lost", (e) => cb(e.payload));

export const onIncomingSignal = (
  cb: (s: IncomingSignal) => void,
): Promise<UnlistenFn> =>
  listen<IncomingSignal>("signal:incoming", (e) => cb(e.payload));
