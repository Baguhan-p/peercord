/** Second column: channel list + connection summary. */
import { ChevronDown, Hash, Network, Volume2 } from "lucide-react";
import clsx from "clsx";
import { useAppStore } from "../store/useAppStore";

const CHANNELS = [
  { id: "network", label: "network", icon: Network },
  { id: "general", label: "general", icon: Hash, phase: 2 },
  { id: "media", label: "media", icon: Hash, phase: 2 },
  { id: "voice", label: "Voice Lounge", icon: Volume2, phase: 3 },
];

export default function ChannelSidebar() {
  const activeChannel = useAppStore((s) => s.activeChannel);
  const setActiveChannel = useAppStore((s) => s.setActiveChannel);
  const peerCount = useAppStore((s) => Object.keys(s.peers).length);
  const connected = useAppStore(
    (s) => Object.values(s.peers).filter((p) => p.state === "connected").length,
  );

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-d-800">
      <button className="flex h-12 items-center justify-between border-b border-d-950/50 px-4 text-[15px] font-semibold shadow-sm transition-colors hover:bg-d-750">
        <span>Local Space</span>
        <ChevronDown size={16} className="text-d-300" />
      </button>

      <div className="scroll-thin flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-1 flex items-center justify-between px-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-d-300">
            Text Channels
          </span>
        </div>

        {CHANNELS.map((ch) => {
          const Icon = ch.icon;
          const isActive = activeChannel === ch.id;
          const locked = Boolean(ch.phase);
          return (
            <button
              key={ch.id}
              onClick={() => !locked && setActiveChannel(ch.id)}
              disabled={locked}
              title={locked ? `Available in Phase ${ch.phase}` : ch.label}
              className={clsx(
                "group mb-0.5 flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-[15px] transition-colors",
                isActive
                  ? "bg-d-600 text-white"
                  : "text-d-300 hover:bg-d-700 hover:text-d-100",
                locked && "cursor-not-allowed opacity-40 hover:bg-transparent",
              )}
            >
              <Icon size={18} className="shrink-0" />
              <span className="truncate">{ch.label}</span>
              {locked && (
                <span className="ml-auto text-[10px] font-medium text-d-400">
                  P{ch.phase}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="border-t border-d-950/50 px-3 py-2 text-[11px] text-d-400">
        <div className="flex justify-between">
          <span>Discovered</span>
          <span className="font-mono text-d-200">{peerCount}</span>
        </div>
        <div className="flex justify-between">
          <span>DataChannels</span>
          <span className="font-mono text-d-green">{connected}</span>
        </div>
      </div>
    </aside>
  );
}
