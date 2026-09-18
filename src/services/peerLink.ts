/**
 * PeerLink — one RTCPeerConnection + one DataChannel per remote peer.
 *
 * Uses the "perfect negotiation" pattern so that both sides can safely
 * create offers without glare:
 *   - `polite` peer rolls back on collision
 *   - `impolite` peer ignores colliding offers
 *
 * Phase 1: only the DataChannel is used (chat / CRDT / control later).
 * Media tracks will be attached in Phase 3 without changing this API.
 */
import type { SignalEnvelope, SignalKind } from "../lib/types";

export type LinkState =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "failed"
  | "closed";

export interface PeerLinkOptions {
  peerId: string;
  /** true → this side yields on offer collision. */
  polite: boolean;
  /** Transport callback: hands a signaling message to the Rust TCP relay. */
  send: (kind: SignalKind, payload: unknown) => void;
  onStateChange: (state: LinkState) => void;
  onOpen: () => void;
  onClose: () => void;
  onMessage: (data: string) => void;
  onRtt: (ms: number) => void;
  onLog: (text: string, level?: "info" | "warn" | "error") => void;
}

/**
 * LAN-only mesh: no STUN/TURN needed — host candidates are sufficient.
 * When NAT traversal lands in a later phase, prepend public STUN servers.
 */
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [],
  iceCandidatePoolSize: 0,
  bundlePolicy: "max-bundle",
};

const PING_INTERVAL_MS = 3000;

export class PeerLink {
  readonly peerId: string;

  private readonly pc: RTCPeerConnection;
  private readonly opts: PeerLinkOptions;
  private readonly polite: boolean;

  private dc: RTCDataChannel | null = null;
  private pingTimer: number | null = null;

  private makingOffer = false;
  private ignoreOffer = false;
  private closed = false;

  constructor(opts: PeerLinkOptions) {
    this.opts = opts;
    this.peerId = opts.peerId;
    this.polite = opts.polite;

    this.pc = new RTCPeerConnection(RTC_CONFIG);
    this.wirePeerConnection();

    // The impolite side owns the DataChannel; the polite side receives it.
    if (!this.polite) {
      this.attachDataChannel(
        this.pc.createDataChannel("peercord", { ordered: true }),
      );
    }
    // Either way, negotiationneeded fires and the offer is created below.
  }

  /* ---------------------------------------------------------------- */
  /* Public API                                                        */
  /* ---------------------------------------------------------------- */

  get state(): LinkState {
    return this.pc.connectionState as LinkState;
  }

  get isOpen(): boolean {
    return this.dc?.readyState === "open";
  }

  /** Feed an incoming SDP description or ICE candidate into the connection. */
  async handleSignal(kind: SignalKind, payload: unknown): Promise<void> {
    if (this.closed) return;
    try {
      if (kind === "description") {
        await this.handleDescription(payload as RTCSessionDescriptionInit);
      } else {
        await this.handleIce(payload as RTCIceCandidateInit);
      }
    } catch (err) {
      this.opts.onLog(`signal error (${kind}): ${String(err)}`, "error");
    }
  }

  /** Send a UTF-8 string over the DataChannel. Returns false if not open. */
  sendText(text: string): boolean {
    if (this.dc?.readyState !== "open") return false;
    this.dc.send(text);
    return true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopPing();
    try {
      this.dc?.close();
    } catch {
      /* noop */
    }
    try {
      this.pc.close();
    } catch {
      /* noop */
    }
    this.opts.onStateChange("closed");
  }

  /* ---------------------------------------------------------------- */
  /* Internals                                                         */
  /* ---------------------------------------------------------------- */

  private wirePeerConnection(): void {
    this.pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        if (this.pc.localDescription) {
          this.opts.send("description", this.pc.localDescription.toJSON());
        }
      } catch (err) {
        this.opts.onLog(`negotiationneeded failed: ${String(err)}`, "error");
      } finally {
        this.makingOffer = false;
      }
    };

    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.opts.send("ice", candidate.toJSON());
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      const st = this.pc.iceConnectionState;
      if (st === "failed") {
        this.opts.onStateChange("failed");
        this.opts.onLog("ICE failed — peer unreachable", "error");
      }
    };

    this.pc.onconnectionstatechange = () => {
      const st = this.pc.connectionState as LinkState;
      this.opts.onStateChange(st);
      if (st === "connected") this.startPing();
      if (st === "disconnected" || st === "failed" || st === "closed") {
        this.stopPing();
      }
    };

    this.pc.ondatachannel = (event) => {
      this.attachDataChannel(event.channel);
    };
  }

  private attachDataChannel(channel: RTCDataChannel): void {
    this.dc = channel;
    channel.binaryType = "arraybuffer";

    channel.onopen = () => {
      this.opts.onLog(`DataChannel open with ${this.peerId.slice(0, 8)}`, "info");
      this.opts.onOpen();
      this.startPing();
    };

    channel.onclose = () => {
      this.opts.onLog(`DataChannel closed with ${this.peerId.slice(0, 8)}`, "warn");
      this.opts.onClose();
      this.stopPing();
    };

    channel.onerror = (e) => {
      this.opts.onLog(
        `DataChannel error: ${String((e as RTCErrorEvent).error ?? e)}`,
        "error",
      );
    };

    channel.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      this.handleIncoming(event.data);
    };
  }

  /** Intercept control frames (ping/pong) before surfacing to the app. */
  private handleIncoming(raw: string): void {
    try {
      const msg = JSON.parse(raw) as { t?: string; ts?: number };
      if (msg.t === "ping" && typeof msg.ts === "number") {
        this.dc?.send(JSON.stringify({ t: "pong", ts: msg.ts }));
        return;
      }
      if (msg.t === "pong" && typeof msg.ts === "number") {
        this.opts.onRtt(Math.max(0, Date.now() - msg.ts));
        return;
      }
    } catch {
      /* not JSON — fall through and treat as plain text */
    }
    this.opts.onMessage(raw);
  }

  private async handleDescription(
    description: RTCSessionDescriptionInit,
  ): Promise<void> {
    const offerCollision =
      description.type === "offer" &&
      (this.makingOffer || this.pc.signalingState !== "stable");

    this.ignoreOffer = !this.polite && offerCollision;
    if (this.ignoreOffer) {
      this.opts.onLog("ignoring colliding offer (impolite side)", "warn");
      return;
    }

    await this.pc.setRemoteDescription(description);

    if (description.type === "offer") {
      await this.pc.setLocalDescription();
      if (this.pc.localDescription) {
        this.opts.send("description", this.pc.localDescription.toJSON());
      }
    }
  }

  private async handleIce(candidate: RTCIceCandidateInit): Promise<void> {
    try {
      await this.pc.addIceCandidate(candidate);
    } catch (err) {
      if (!this.ignoreOffer) throw err;
    }
  }

  private startPing(): void {
    if (this.pingTimer !== null) return;
    this.pingTimer = window.setInterval(() => {
      if (this.dc?.readyState === "open") {
        this.dc.send(JSON.stringify({ t: "ping", ts: Date.now() }));
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
