/**
 * bootstrap.ts — wires the Rust core (mDNS + TCP signaling) to the
 * frontend peer manager.
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
import { peerManager } from "./peerManager";

let unlisteners: UnlistenFn[] = [];
let booted = false;

/** Random 16-hex-char identity, unique per process. */
function makePeerId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fresh display name per process — localStorage is shared between instances. */
function makeDisplayName(): string {
  const adjectives = ["Silent", "Cosmic", "Lunar", "Rusty", "Neon", "Velvet"];
  const nouns = ["Otter", "Falcon", "Comet", "Cactus", "Lynx", "Nebula"];
  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  return `${pick(adjectives)} ${pick(nouns)}`;
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

  store.log(`starting node as "${name}" (${id.slice(0, 8)})`, "info");

  try {
    const info = await startNode(id, name);
    store.setNodeInfo(info);
    peerManager.configure({
      selfId: info.peerId,
      selfName: info.displayName,
      selfPort: info.signalPort,
    });
    store.log(`signaling TCP listener bound on port ${info.signalPort}`, "net");
    store.log("browsing mDNS service _peercord._tcp.local.", "net");

    unlisteners = await Promise.all([
      onPeerFound((p) => peerManager.onPeerFound(p)),
      onPeerLost((p) => peerManager.onPeerLost(p)),
      onIncomingSignal((s) => void peerManager.onIncomingSignal(s)),
    ]);

    store.setReady(true);
  } catch (err) {
    store.log(`failed to start node: ${String(err)}`, "error");
    store.setReady(false);
  }
}

export function teardown(): void {
  unlisteners.forEach((fn) => fn());
  unlisteners = [];
  peerManager.reset();
  booted = false;
}