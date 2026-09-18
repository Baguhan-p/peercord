/**
 * bootstrap.ts — wires the Rust core (mDNS + TCP signaling) to the
 * frontend peer manager, and installs the CRDT sync bridge.
 *
 * Ordering matters:
 *   1. Load CRDT documents from IndexedDB (so peer sync starts from a
 *      known state, not an empty document).
 *   2. Boot the network node (mDNS + signaling listener).
 *   3. Install the Yjs <-> DataChannel bridge — it hooks link-open events,
 *      which are only emitted after links exist.
 *   4. Subscribe to Tauri events.
 */
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  isTauri,
  onIncomingSignal,
  onPeerFound,
  onPeerLost,
  startNode,
} from "../lib/tauriBridge";
import { useAppStore } from "../store/useAppStore";
import { initChat } from "./chatService";
import { peerManager } from "./peerManager";
import { installSyncChannel } from "./syncChannel";

let unlisteners: UnlistenFn[] = [];
let booted = false;

/** Random 16-hex-char identity, unique per process. */
function makePeerId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Fresh display name per process. We do NOT persist it in localStorage
 * because all Tauri instances share the same WebView2 profile, and we
 * don't want two windows impersonating each other.
 */
function makeDisplayName(): string {
  const adjectives = [
    "Silent",
    "Cosmic",
    "Lunar",
    "Rusty",
    "Neon",
    "Velvet",
    "Amber",
    "Cobalt",
    "Frosty",
    "Golden",
  ];
  const nouns = [
    "Otter",
    "Falcon",
    "Comet",
    "Cactus",
    "Lynx",
    "Nebula",
    "Fox",
    "Raven",
    "Panda",
    "Wolf",
  ];
  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const hex = Math.floor(Math.random() * 0x1000)
    .toString(16)
    .padStart(3, "0");
  return `${pick(adjectives)} ${pick(nouns)} ${hex}`;
}

export async function bootstrap(): Promise<void> {
  if (booted) return;
  booted = true;

  const store = useAppStore.getState();
  const id = makePeerId();
  const name = makeDisplayName();

  store.setIdentity(id, name);

  if (!isTauri()) {
    store.log(
      "Tauri runtime not detected — running in browser preview mode. " +
        "mDNS discovery is unavailable.",
      "warn",
    );
    store.setReady(false);
    return;
  }

  try {
    // 1. Hydrate CRDT documents from IndexedDB before doing anything else.
    store.log("loading chat history from IndexedDB…", "info");
    await initChat();
    store.log("chat history loaded", "info");

    // 2. Boot the network node.
    store.log(`starting node as "${name}" (${id.slice(0, 8)})`, "info");
    const info = await startNode(id, name);
    store.setNodeInfo(info);
    peerManager.configure({
      selfId: info.peerId,
      selfName: info.displayName,
      selfPort: info.signalPort,
    });
    store.log(`signaling TCP listener bound on port ${info.signalPort}`, "net");
    store.log("browsing mDNS service _peercord._tcp.local.", "net");

    // 3. Install the CRDT bridge — must run before any link opens.
    installSyncChannel();

    // 4. Subscribe to Tauri events.
    unlisteners = await Promise.all([
      onPeerFound((p) => peerManager.onPeerFound(p)),
      onPeerLost((p) => peerManager.onPeerLost(p)),
      onIncomingSignal((s) => void peerManager.onIncomingSignal(s)),
    ]);

    store.setReady(true);
  } catch (err) {
    store.log(`bootstrap failed: ${String(err)}`, "error");
    store.setReady(false);
  }
}

export function teardown(): void {
  unlisteners.forEach((fn) => fn());
  unlisteners = [];
  peerManager.reset();
  booted = false;
}
