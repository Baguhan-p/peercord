/**
 * PeerManager — single source of truth for live peer connections.
 *
 * Responsibilities:
 *   • turn discovery / signaling events into PeerLink instances
 *   • decide who initiates the offer (deterministic, no glare)
 *   • mirror link state / RTT into the Zustand store
 *   • expose pub/sub hooks for higher layers (chat sync, presence, …)
 *
 * Supports two ways to establish a link:
 *   • mDNS auto-discovery (peer:found event)
 *   • manual connect by IP:port (bypasses mDNS entirely — useful on Windows
 *     where two processes on the same host cannot both receive mDNS multicast)
 */
import type {
  IncomingSignal,
  PeerFoundPayload,
  PeerLostPayload,
  SignalKind,
} from "../lib/types";
import { sendSignal } from "../lib/tauriBridge";
import { useAppStore } from "../store/useAppStore";
import { PeerLink } from "./peerLink";

interface ManagerContext {
  selfId: string;
  selfName: string;
  selfPort: number;
}

interface LinkInfo {
  address: string;
  port: number;
  displayName: string;
}

type LinkOpenListener = (peerId: string) => void;
type MessageListener = (peerId: string, data: string) => void;

/** Prefix for synthetic peer-ids created by manual connect. */
const MANUAL_PREFIX = "zz-manual-";

class PeerManager {
  private links = new Map<string, PeerLink>();
  private info = new Map<string, LinkInfo>();
  private ctx: ManagerContext | null = null;

  private linkOpenListeners = new Set<LinkOpenListener>();
  private messageListeners = new Set<MessageListener>();

  /* ---------------------------------------------------------------- */
  /* Configuration                                                     */
  /* ---------------------------------------------------------------- */

  configure(ctx: ManagerContext): void {
    this.ctx = ctx;
  }

  reset(): void {
    for (const link of this.links.values()) link.close();
    this.links.clear();
    this.info.clear();
    this.ctx = null;
    this.linkOpenListeners.clear();
    this.messageListeners.clear();
  }

  /* ---------------------------------------------------------------- */
  /* Pub/sub                                                           */
  /* ---------------------------------------------------------------- */

  /** Fires once per peer, after its DataChannel becomes usable. */
  onLinkOpen(cb: LinkOpenListener): () => void {
    this.linkOpenListeners.add(cb);
    return () => this.linkOpenListeners.delete(cb);
  }

  /** Fires for every incoming application-level payload (post ping/pong). */
  onMessage(cb: MessageListener): () => void {
    this.messageListeners.add(cb);
    return () => this.messageListeners.delete(cb);
  }

  /* ---------------------------------------------------------------- */
  /* Discovery                                                         */
  /* ---------------------------------------------------------------- */

  onPeerFound(payload: PeerFoundPayload): void {
    const store = useAppStore.getState();
    if (payload.peerId === this.ctx?.selfId) return;
    if (this.links.has(payload.peerId)) return;

    store.upsertPeer({
      peerId: payload.peerId,
      displayName: payload.displayName,
      address: payload.address,
      port: payload.port,
      state: "connecting",
      rttMs: null,
      lastSeen: Date.now(),
      initiator: this.isInitiator(payload.peerId),
    });

    store.log(
      `discovered ${payload.displayName} @ ${payload.address}:${payload.port}`,
      "net",
    );

    this.ensureLink({
      peerId: payload.peerId,
      displayName: payload.displayName,
      address: payload.address,
      port: payload.port,
    });
  }

  onPeerLost(payload: PeerLostPayload): void {
    const link = this.links.get(payload.peerId);
    if (link) {
      link.close();
      this.links.delete(payload.peerId);
      this.info.delete(payload.peerId);
    }
    useAppStore.getState().removePeer(payload.peerId);
    useAppStore.getState().log(`peer lost: ${payload.peerId.slice(0, 8)}`, "warn");
  }

  /* ---------------------------------------------------------------- */
  /* Manual connect                                                    */
  /* ---------------------------------------------------------------- */

  /** Dial a peer by IP:port without mDNS. Returns false if node isn't ready. */
  connectManual(addr: string, port: number): boolean {
    if (!this.ctx) return false;
    const synth = `${MANUAL_PREFIX}${addr}-${port}`;

    const store = useAppStore.getState();
    store.upsertPeer({
      peerId: synth,
      displayName: `${addr}:${port}`,
      address: addr,
      port,
      state: "connecting",
      rttMs: null,
      lastSeen: Date.now(),
      initiator: true,
    });
    store.log(`manual connect → ${addr}:${port}`, "net");

    this.ensureLink({
      peerId: synth,
      displayName: `${addr}:${port}`,
      address: addr,
      port,
    });
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* Signaling                                                         */
  /* ---------------------------------------------------------------- */

  async onIncomingSignal(signal: IncomingSignal): Promise<void> {
    if (!this.ctx || signal.from === this.ctx.selfId) return;

    let link = this.links.get(signal.from);

    // If we dialed out manually, we used a synthetic peerId. Re-key the
    // existing link under the remote's real peerId now that we know it.
    if (!link) {
      for (const [key, l] of this.links.entries()) {
        if (!key.startsWith(MANUAL_PREFIX)) continue;
        const meta = this.info.get(key);
        if (!meta) continue;
        if (meta.address !== signal.addr || meta.port !== signal.fromSignalPort) {
          continue;
        }

        this.links.delete(key);
        this.links.set(signal.from, l);
        this.info.delete(key);
        this.info.set(signal.from, meta);

        const store = useAppStore.getState();
        store.removePeer(key);
        store.upsertPeer({
          peerId: signal.from,
          displayName: signal.fromName || signal.from.slice(0, 8),
          address: meta.address,
          port: meta.port,
          state: l.state === "connected" ? "connected" : "connecting",
          rttMs: null,
          lastSeen: Date.now(),
          initiator: true,
        });
        store.log(
          `manual link matched → ${signal.fromName} (${signal.from.slice(0, 8)})`,
          "net",
        );
        link = l;
        break;
      }
    }

    if (!link) {
      const store = useAppStore.getState();
      store.upsertPeer({
        peerId: signal.from,
        displayName: signal.fromName || signal.from.slice(0, 8),
        address: signal.addr,
        port: signal.fromSignalPort,
        state: "connecting",
        rttMs: null,
        lastSeen: Date.now(),
        initiator: this.isInitiator(signal.from),
      });
      store.log(
        `learned peer via signaling: ${signal.fromName} @ ${signal.addr}:${signal.fromSignalPort}`,
        "net",
      );
      link = this.ensureLink({
        peerId: signal.from,
        displayName: signal.fromName || signal.from.slice(0, 8),
        address: signal.addr,
        port: signal.fromSignalPort,
      });
    }

    await link.handleSignal(signal.kind as SignalKind, signal.payload);
  }

  /* ---------------------------------------------------------------- */
  /* Transport                                                         */
  /* ---------------------------------------------------------------- */

  /** Send a raw string to one specific peer. Returns false if not open. */
  sendToPeer(peerId: string, text: string): boolean {
    const link = this.links.get(peerId);
    return link ? link.sendText(text) : false;
  }

  /** Send a raw string to every open DataChannel. Returns delivered count. */
  broadcast(text: string): number {
    let delivered = 0;
    for (const link of this.links.values()) {
      if (link.sendText(text)) delivered += 1;
    }
    return delivered;
  }

  /* ---------------------------------------------------------------- */
  /* Internals                                                         */
  /* ---------------------------------------------------------------- */

  private isInitiator(remoteId: string): boolean {
    if (!this.ctx) return false;
    return this.ctx.selfId < remoteId;
  }

  private looksLikeYjsFrame(raw: string): boolean {
    // Cheap pre-filter: avoid JSON.parse on every incoming ping-free frame.
    if (raw.length < 12 || raw.charCodeAt(0) !== 0x7b /* '{' */) return false;
    return raw.startsWith('{"t":"yjs"') || raw.includes('"t":"yjs"');
  }

  private ensureLink(info: {
    peerId: string;
    displayName: string;
    address: string;
    port: number;
  }): PeerLink {
    const existing = this.links.get(info.peerId);
    if (existing) return existing;

    if (!this.ctx) {
      throw new Error("PeerManager used before configure()");
    }

    const store = useAppStore.getState();
    const polite = !this.isInitiator(info.peerId);
    const short = info.peerId.slice(0, 8);

    const link = new PeerLink({
      peerId: info.peerId,
      polite,
      send: (kind, payload) => {
        const ctx = this.ctx!;
        void sendSignal(info.address, info.port, {
          from: ctx.selfId,
          fromName: ctx.selfName,
          fromSignalPort: ctx.selfPort,
          kind,
          payload,
        }).catch((err) => {
          store.log(
            `send_signal → ${short} @ ${info.address}:${info.port} failed: ${String(err)}`,
            "error",
          );
        });
      },
      onStateChange: (state) => {
        useAppStore.getState().patchPeer(info.peerId, { state });
      },
      onOpen: () => {
        useAppStore.getState().patchPeer(info.peerId, {
          state: "connected",
          lastSeen: Date.now(),
        });
        // Notify subscribers that this DataChannel is now usable.
        for (const cb of this.linkOpenListeners) {
          try {
            cb(info.peerId);
          } catch (err) {
            useAppStore
              .getState()
              .log(`linkOpen listener failed: ${String(err)}`, "error");
          }
        }
      },
      onClose: () => {
        useAppStore.getState().patchPeer(info.peerId, { state: "disconnected" });
      },
      onMessage: (data) => {
        // Keep the network log readable: Yjs frames are frequent and verbose.
        if (!this.looksLikeYjsFrame(data)) {
          useAppStore.getState().log(`◀ ${short}: ${data}`, "net");
        }
        for (const cb of this.messageListeners) {
          try {
            cb(info.peerId, data);
          } catch (err) {
            useAppStore
              .getState()
              .log(`message listener failed: ${String(err)}`, "error");
          }
        }
      },
      onRtt: (ms) => {
        useAppStore.getState().patchPeer(info.peerId, {
          rttMs: ms,
          lastSeen: Date.now(),
        });
      },
      onLog: (text, level = "info") => {
        useAppStore.getState().log(`[${short}] ${text}`, level);
      },
    });

    this.links.set(info.peerId, link);
    this.info.set(info.peerId, {
      address: info.address,
      port: info.port,
      displayName: info.displayName,
    });
    store.log(
      `link created with ${info.displayName} (${polite ? "polite" : "impolite"})`,
      "net",
    );
    return link;
  }
}

export const peerManager = new PeerManager();
