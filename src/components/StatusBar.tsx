/** Bottom bar: identity + connection summary. */
import { Headphones, Mic, Settings, Signal } from "lucide-react";
import { useAppStore } from "../store/useAppStore";

export default function StatusBar() {
  const selfName = useAppStore((s) => s.selfName);
  const selfId = useAppStore((s) => s.selfId);
  const peers = useAppStore((s) => s.peers);
  const connected = Object.values(peers).filter(
    (p) => p.state === "connected",
  ).length;

  return (
    <footer className="flex h-14 shrink-0 items-center gap-3 border-t border-d-950/50 bg-d-850 px-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-d-accent text-sm font-bold text-white">
        {selfName.slice(0, 1).toUpperCase() || "?"}
      </div>

      <div className="min-w-0">
        <div className="truncate text-sm font-medium leading-tight text-d-100">
          {selfName || "…"}
        </div>
        <div className="truncate font-mono text-[10px] leading-tight text-d-400">
          {selfId.slice(0, 12) || "initializing"}
        </div>
      </div>

      <div className="flex-1" />

      <span className="chip bg-d-700 text-d-200">
        <Signal size={11} className={connected ? "text-d-green" : "text-d-400"} />
        {connected} peer{connected === 1 ? "" : "s"}
      </span>

      <div className="flex items-center gap-1">
        <button className="icon-btn" disabled title="Mic (Phase 3)">
          <Mic size={16} />
        </button>
        <button className="icon-btn" disabled title="Deafen (Phase 3)">
          <Headphones size={16} />
        </button>
        <button className="icon-btn" disabled title="Settings (Phase 5)">
          <Settings size={16} />
        </button>
      </div>
    </footer>
  );
}
