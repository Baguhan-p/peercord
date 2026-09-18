/**
 * syncChannel — bridges Yjs documents to the WebRTC DataChannel.
 *
 * Wire format (see YjsFrame in lib/types.ts):
 *
 *   sync1  → our state vector
 *   sync2  → diff computed against the remote's state vector
 *   update → incremental local change
 *
 * On link open:  send sync1 for every channel.
 * On sync1:      reply with sync2 computed from the remote's vector.
 * On sync2:      apply the diff.
 * On update:     apply the change.
 *
 * Both sides send sync1, so both sides end up with each other's missing
 * operations — no directional assumption, no master peer.
 */
import * as Y from "yjs";
import {
  CHAT_CHANNELS,
  isChatChannel,
  type TextChannelId,
  type YjsFrame,
} from "../lib/types";
import { peerManager } from "./peerManager";
import {
  applyRemoteUpdate,
  base64ToBytes,
  bytesToBase64,
  getChatDoc,
  onLocalUpdate,
} from "./chatService";

let installed = false;

/* ------------------------------------------------------------------ */
/* Outbound                                                            */
/* ------------------------------------------------------------------ */

function toPeer(peerId: string, frame: YjsFrame): void {
  peerManager.sendToPeer(peerId, JSON.stringify(frame));
}

function toAll(frame: YjsFrame): void {
  peerManager.broadcast(JSON.stringify(frame));
}

function sendSync1(peerId: string, channel: TextChannelId): void {
  const doc = getChatDoc(channel);
  const sv = Y.encodeStateVector(doc);
  toPeer(peerId, { t: "yjs", ch: channel, k: "sync1", sv: bytesToBase64(sv) });
}

function sendSync2(
  peerId: string,
  channel: TextChannelId,
  remoteSv: Uint8Array,
): void {
  const doc = getChatDoc(channel);
  const diff = Y.encodeStateAsUpdate(doc, remoteSv);
  toPeer(peerId, {
    t: "yjs",
    ch: channel,
    k: "sync2",
    diff: bytesToBase64(diff),
  });
}

/* ------------------------------------------------------------------ */
/* Inbound                                                             */
/* ------------------------------------------------------------------ */

function handleFrame(senderId: string, raw: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { t?: unknown }).t !== "yjs"
  ) {
    return;
  }

  const frame = parsed as YjsFrame;
  if (!isChatChannel(frame.ch)) return;

  switch (frame.k) {
    case "sync1": {
      const sv = base64ToBytes(frame.sv);
      sendSync2(senderId, frame.ch, sv);
      break;
    }
    case "sync2": {
      const diff = base64ToBytes(frame.diff);
      applyRemoteUpdate(frame.ch, diff);
      break;
    }
    case "update": {
      const u = base64ToBytes(frame.u);
      applyRemoteUpdate(frame.ch, u);
      break;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Install                                                             */
/* ------------------------------------------------------------------ */

export function installSyncChannel(): void {
  if (installed) return;
  installed = true;

  // 1. On every newly opened DataChannel, request a fresh state vector diff.
  peerManager.onLinkOpen((peerId) => {
    for (const ch of CHAT_CHANNELS) {
      sendSync1(peerId, ch);
    }
  });

  // 2. Frames arriving from any peer.
  peerManager.onMessage((peerId, data) => {
    handleFrame(peerId, data);
  });

  // 3. Local changes → broadcast to every open DataChannel.
  onLocalUpdate((channel, update) => {
    toAll({
      t: "yjs",
      ch: channel,
      k: "update",
      u: bytesToBase64(update),
    });
  });
}
