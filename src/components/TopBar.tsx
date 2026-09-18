/** Channel header — identity, mDNS status, manual connect, broadcast action. */
import { useState } from "react";
import { Link2, Network, Radio, Send, Trash2 } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { peerManager } from "../services/peerManager";

export default function TopBar() {
  const ready = useAppStore((s) => s.ready);
  const nodeInfo = useAppStore((s) => s.nodeInfo);
  const clearLogs = useAppStore((s) => s.clearLogs);
  const log = useAppStore((s) => s.log);
  const connected = useAppStore(
    (s) => Object.values(s.peers).filter((p) => p.state === "connected").length,
  );

  const [showManual, setShowManual] = useState(false);
  const [manual, setManual] = useState("");

  const handleBroadcast = () => {
    const payload = JSON.stringify({
      t: "test",
      ts: Date.now(),
      body: "hello from PeerCord Phase 1",
    });
    const delivered = peerManager.broadcast(payload);
    log(`▶ broadcast → ${delivered} channel(s)`, "net");
  };

  const handleManual = () => {
    const m = manual.trim().match(/^(\[[0-9a-fA-F:]+\]|[0-9.]+):(\d+)$/);
    if (!m) {
      log(`invalid address: "${manual}" — expected IP:port`, "error");
      return;
    }
    const addr = m[1].replace(/^\[|\]$/g, "");
    const port = Number.parseInt(m[2], 10);
    if (!peerManager.connectManual(addr, port)) {
      log("peerManager not ready", "error");
      return;
    }
    setManual("");
    setShowManual(false);
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-d-950/50 px-4 shadow-sm">
      <Network size={20} className="text-d-300" />
      <h1 className="text-[15px] font-semibold">network</h1>

      <div className="mx-2 h-6 w-px bg-d-700" />

      <span className="chip bg-d-700 text-d-200">
        <Radio size={12} className={ready ? "text-d-green" : "text-d-red"} />
        {ready ? "mDNS active" : "offline"}
      </span>

      {nodeInfo && (
        <span className="chip bg-d-700 font-mono text-d-300">
          :{nodeInfo.signalPort}
        </span>
      )}

      <div className="flex-1" />

      {showManual ? (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleManual();
              if (e.key === "Escape") {
                setShowManual(false);
                setManual("");
              }
            }}
            placeholder="192.168.0.85:60401"
            className="w-48 rounded bg-d-600 px-2 py-1 font-mono text-xs text-d-text outline-none focus:bg-d-500"
          />
          <button
            onClick={handleManual}
            className="rounded bg-d-accent px-2 py-1 text-xs font-medium text-white hover:bg-d-accent-hover"
          >
            Go
          </button>
          <button
            onClick={() => {
              setShowManual(false);
              setManual("");
            }}
            className="icon-btn"
            title="Cancel"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowManual(true)}
          className="icon-btn"
          title="Connect by IP:port (bypasses mDNS)"
        >
          <Link2 size={16} />
        </button>
      )}

      <button
        onClick={handleBroadcast}
        disabled={connected === 0}
        className="flex items-center gap-1.5 rounded bg-d-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-d-accent-hover disabled:cursor-not-allowed disabled:bg-d-600 disabled:text-d-400"
        title="Send a test payload over every open DataChannel"
      >
        <Send size={14} />
        Broadcast
      </button>

      <button onClick={clearLogs} className="icon-btn" title="Clear log">
        <Trash2 size={16} />
      </button>
    </header>
  );
}