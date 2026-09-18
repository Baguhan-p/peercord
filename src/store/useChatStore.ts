/**
 * Chat UI state — mirrors the CRDT documents.
 *
 * The actual source of truth is the Yjs document; this store only holds
 * a denormalized snapshot for fast React rendering, plus per-channel drafts.
 */
import { create } from "zustand";
import type { ChatMessage } from "../lib/types";

interface ChatState {
  /** Denormalized messages per channel (sorted by ts ascending). */
  messages: Record<string, ChatMessage[]>;
  /** Draft text per channel — survives channel switching. */
  drafts: Record<string, string>;

  setMessages: (channel: string, messages: ChatMessage[]) => void;
  setDraft: (channel: string, text: string) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: {},
  drafts: {},

  setMessages: (channel, messages) =>
    set((state) => ({
      messages: { ...state.messages, [channel]: messages },
    })),

  setDraft: (channel, text) =>
    set((state) => ({
      drafts: { ...state.drafts, [channel]: text },
    })),
}));
