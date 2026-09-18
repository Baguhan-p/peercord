/** Right column: online members with network indicators. */
import { useAppStore } from "../store/useAppStore";

function pingColor(rtt: number | null, state: string): string {
  if (state !== "connected") return "bg-d-400";
  if (rtt === null) return "bg-d-yellow";
  if (rtt < 40) return "bg-d-green";
  if (rtt < 120) return "bg-d-yellow";
  return "bg-d-red";
}

export default function MemberSidebar() {
  const selfName = useAppStore((s) => s.selfName);
  const selfId = useAppStore((s) => s.selfId);
  const peers = useAppStore((s) => s.peers);
  const peerList = Object.values(peers);

  return (
    <aside className="scroll-thin hidden w-60 shrink-0 overflow-y-auto bg-d-800 px-3 py-4 lg:block">
      <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-d-300">
        Online — {peerList.length + 1}
      </h2>

      {/* self */}
      <div className="mb-1 flex items-center gap-2 rounded px-1 py-1.5">
        <div className="relative">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-d-accent text-xs font-bold text-white">
            {selfName.slice(0, 1).toUpperCase() || "?"}
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-d-800 bg-d-green" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-d-100">{selfName || "…"}</div>
          <div className="truncate font-mono text-[10px] text-d-500">
            {selfId.slice(0, 10) || "—"}
          </div>
        </div>
        <span className="text-[10px] font-medium text-d-400">you</span>
      </div>

      {peerList.map((peer) => (
        <div
          key={peer.peerId}
          className="mb-0.5 flex items-center gap-2 rounded px-1 py-1.5 hover:bg-d-700/60"
        >
          <div className="relative">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-d-600 text-xs font-bold text-d-100">
              {peer.displayName.slice(0, 1).toUpperCase()}
            </div>
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-d-800 ${pingColor(
                peer.rttMs,
                peer.state,
              )}`}
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-d-200">
              {peer.displayName}
            </div>
            <div className="truncate font-mono text-[10px] text-d-500">
              {peer.state === "connected"
                ? peer.rttMs === null
                  ? "measuring…"
                  : `${peer.rttMs} ms`
                : peer.state}
            </div>
          </div>
        </div>
      ))}
    </aside>
  );
}
