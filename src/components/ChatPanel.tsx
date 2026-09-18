/**
 * ChatPanel — Discord-style message list + composer for a text channel.
 * Reads messages from the useChatStore snapshot (which mirrors the Yjs doc).
 */
import { useEffect, useRef, type KeyboardEvent } from "react";
import { Hash, Send } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { useChatStore } from "../store/useChatStore";
import { isChatChannel, type TextChannelId } from "../lib/types";
import { sendMessage } from "../services/chatService";
import MessageItem from "./MessageItem";

export default function ChatPanel() {
  const activeChannel = useAppStore((s) => s.activeChannel);
  const selfId = useAppStore((s) => s.selfId);

  const messages = useChatStore((s) =>
    isChatChannel(activeChannel) ? s.messages[activeChannel] ?? [] : [],
  );
  const draft = useChatStore((s) =>
    isChatChannel(activeChannel) ? s.drafts[activeChannel] ?? "" : "",
  );
  const setDraft = useChatStore((s) => s.setDraft);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new messages or channel switch.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, activeChannel]);

  // Focus composer when entering a channel.
  useEffect(() => {
    textareaRef.current?.focus();
  }, [activeChannel]);

  if (!isChatChannel(activeChannel)) return null;
  const channel: TextChannelId = activeChannel;

  const handleSend = () => {
    if (sendMessage(channel, draft)) {
      setDraft(channel, "");
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.style.height = "auto";
          el.focus();
        }
      });
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Message list ------------------------------------------------ */}
      <div ref={scrollRef} className="scroll-thin flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-d-700">
              <Hash size={32} className="text-d-300" />
            </div>
            <div className="text-xl font-semibold text-d-100">
              Welcome to #{channel}
            </div>
            <div className="mt-1 max-w-md text-sm text-d-400">
              This is the beginning of the #{channel} channel. Messages are
              synchronized peer-to-peer and stored locally.
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {messages.map((m) => (
              <MessageItem key={m.id} msg={m} isSelf={m.author === selfId} />
            ))}
          </div>
        )}
      </div>

      {/* Composer ---------------------------------------------------- */}
      <div className="shrink-0 px-4 pb-4">
        <div className="flex items-end gap-2 rounded-lg bg-d-600 px-3 py-2 transition-colors focus-within:bg-d-650">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              setDraft(channel, e.target.value);
              autoResize(e.target);
            }}
            onKeyDown={handleKeyDown}
            placeholder={`Message #${channel}`}
            rows={1}
            className="scroll-thin max-h-48 min-h-[24px] flex-1 resize-none bg-transparent text-[15px] leading-[1.4] text-d-text outline-none placeholder:text-d-400"
          />
          <button
            onClick={handleSend}
            disabled={!draft.trim()}
            title="Send (Enter)"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-d-300 transition-colors hover:bg-d-accent hover:text-white disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-d-300"
          >
            <Send size={16} />
          </button>
        </div>
        <div className="mt-1.5 px-1 text-[11px] text-d-500">
          Enter — send · Shift+Enter — new line · history synced via Yjs CRDT
        </div>
      </div>
    </div>
  );
}
