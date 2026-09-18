/**
 * chatService — CRDT layer for PeerCord chat.
 *
 * One `Y.Doc` per text channel, backed by `y-indexeddb` for local
 * persistence. All replicas of a channel converge to the same state;
 * there is no "authoritative" peer.
 *
 * The service is the single owner of the Y.Doc instances; everything
 * else (UI, sync bridge) goes through it.
 */
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import {
  CHAT_CHANNELS,
  type ChatMessage,
  type TextChannelId,
} from "../lib/types";
import { useAppStore } from "../store/useAppStore";
import { useChatStore } from "../store/useChatStore";

/**
 * Sentinel origin used when applying remote updates.
 * Local update handlers ignore events with this origin to avoid echo.
 */
export const REMOTE_ORIGIN = Symbol("peercord.remote");

const docs = new Map<TextChannelId, Y.Doc>();
const persistences = new Map<TextChannelId, IndexeddbPersistence>();

let initialized = false;
let updateListenerInstalled = false;

/* ------------------------------------------------------------------ */
/* Document access                                                     */
/* ------------------------------------------------------------------ */

/** Lazily creates (and persists) the Y.Doc for a channel. */
export function getChatDoc(channel: TextChannelId): Y.Doc {
  const existing = docs.get(channel);
  if (existing) return existing;

  const doc = new Y.Doc({ guid: `peercord-${channel}` });
  docs.set(channel, doc);

  const persistence = new IndexeddbPersistence(`peercord-${channel}`, doc);
  persistences.set(channel, persistence);

  return doc;
}

/* ------------------------------------------------------------------ */
/* Base64 helpers                                                      */
/* ------------------------------------------------------------------ */

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

function readMessages(channel: TextChannelId): ChatMessage[] {
  const doc = getChatDoc(channel);
  const arr = doc.getArray<Y.Map<unknown>>("messages");

  const out: ChatMessage[] = [];
  arr.forEach((item) => {
    const raw = item.toJSON() as Record<string, unknown>;
    out.push({
      id: String(raw.id ?? ""),
      channel,
      author: String(raw.author ?? ""),
      authorName: String(raw.authorName ?? "Unknown"),
      text: String(raw.text ?? ""),
      ts: Number(raw.ts ?? 0),
    });
  });

  // Y.Array preserves insertion order (client-id tiebreak), but we want a
  // human-friendly chronological order in the UI.
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

/**
 * Loads every channel from IndexedDB, wires observers into the Zustand
 * store, and seeds the initial messages. Call once at bootstrap.
 */
export async function initChat(): Promise<void> {
  if (initialized) return;
  initialized = true;

  // 1. Wait for the IndexedDB cache to hydrate each document.
  await Promise.all(
    CHAT_CHANNELS.map(async (ch) => {
      getChatDoc(ch);
      const persistence = persistences.get(ch);
      if (persistence) await persistence.whenSynced;
    }),
  );

  // 2. Observe every channel's message array and mirror it into Zustand.
  for (const ch of CHAT_CHANNELS) {
    const doc = getChatDoc(ch);
    const arr = doc.getArray<Y.Map<unknown>>("messages");
    arr.observe(() => {
      useChatStore.getState().setMessages(ch, readMessages(ch));
    });
    // Seed initial snapshot (in case IndexedDB already had content).
    useChatStore.getState().setMessages(ch, readMessages(ch));
  }
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

/** Appends a message to the given channel. Returns false on empty input. */
export function sendMessage(channel: TextChannelId, text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const { selfId, selfName } = useAppStore.getState();
  if (!selfId) return false;

  const doc = getChatDoc(channel);
  const arr = doc.getArray<Y.Map<unknown>>("messages");

  const map = new Y.Map<unknown>();
  map.set("id", `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  map.set("author", selfId);
  map.set("authorName", selfName);
  map.set("text", trimmed);
  map.set("ts", Date.now());

  doc.transact(() => {
    arr.push([map]);
  });

  return true;
}

/* ------------------------------------------------------------------ */
/* Sync hooks                                                          */
/* ------------------------------------------------------------------ */

/**
 * Registers a callback fired on every *local* update to any chat document.
 * Remote updates (origin === REMOTE_ORIGIN) are filtered out.
 *
 * Called exactly once by the sync bridge during install.
 */
export function onLocalUpdate(
  cb: (channel: TextChannelId, update: Uint8Array) => void,
): void {
  if (updateListenerInstalled) return;
  updateListenerInstalled = true;

  for (const ch of CHAT_CHANNELS) {
    const doc = getChatDoc(ch);
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE_ORIGIN) return;
      cb(ch, update);
    });
  }
}

/** Applies an update received from a remote peer. */
export function applyRemoteUpdate(
  channel: TextChannelId,
  update: Uint8Array,
): void {
  const doc = getChatDoc(channel);
  Y.applyUpdate(doc, update, REMOTE_ORIGIN);
}
