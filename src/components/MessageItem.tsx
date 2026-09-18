/** A single chat message rendered in Discord style. */
import type { ChatMessage } from "../lib/types";

const AVATAR_COLORS = [
  "bg-[#5865f2]",
  "bg-[#23a55a]",
  "bg-[#f0b232]",
  "bg-[#eb459e]",
  "bg-[#f23f43]",
  "bg-[#3ba55d]",
  "bg-[#7289da]",
];

function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");

  if (sameDay) return `Today at ${hh}:${mm}`;
  return `${d.toLocaleDateString()} ${hh}:${mm}`;
}

interface MessageItemProps {
  msg: ChatMessage;
  isSelf: boolean;
}

export default function MessageItem({ msg, isSelf }: MessageItemProps) {
  return (
    <div className="group flex gap-3 rounded px-2 py-1 transition-colors hover:bg-d-800/40">
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${colorFor(
          msg.author,
        )}`}
      >
        {msg.authorName.slice(0, 1).toUpperCase() || "?"}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className={`truncate text-sm font-semibold ${
              isSelf ? "text-d-accent" : "text-d-100"
            }`}
          >
            {msg.authorName}
          </span>
          <span className="shrink-0 text-[11px] text-d-400">
            {formatTime(msg.ts)}
          </span>
        </div>
        <div className="whitespace-pre-wrap break-words text-[15px] leading-[1.4] text-d-100">
          {msg.text}
        </div>
      </div>
    </div>
  );
}
