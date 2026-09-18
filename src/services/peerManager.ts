/**
 * PeerManager — single source of truth for live peer connections.
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

/** Prefix for synthetic peer-ids created by manual connect. 'z' > any hex char,
 *  so the initiator election always picks us as impolite (we send the offer). */
const MANUAL_PREFIX = "zz-manual-";

class PeerManager {
  private links = new Map<string, PeerLink>();
  private info = new Map<string, LinkInfo>();
  private ctx: ManagerContext | null = null;

  configure(ctx: ManagerContext): void {
    this.ctx = ctx;
  }

  reset(): void {
    for (const link of this.links.values()) link.close();
    this.links.clear();
    this.info.clear();
    this.ctx = null;
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
  /* Application payloads                                              */
  /* ---------------------------------------------------------------- */

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
      },
      onClose: () => {
        useAppStore.getState().patchPeer(info.peerId, { state: "disconnected" });
      },
      onMessage: (data) => {
        useAppStore.getState().log(`◀ ${short}: ${data}`, "net");
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