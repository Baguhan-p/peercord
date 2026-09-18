/**
 * Phase 1 core view: live peer cards + a scrolling network log.
 * This is where the mDNS discovery and DataChannel handshake become visible.
 */
import { useEffect, useRef } from "react";
import clsx from "clsx";
import { Activity, Wifi, WifiOff, Loader2 } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import type { LinkState, LogLevel } from "../lib/types";

function stateMeta(state: LinkState) {
  switch (state) {
    case "connected":
      return { label: "connected", cls: "bg-d-green/15 text-d-green", Icon: Wifi };
    case "connecting":
      return { label: "connecting", cls: "bg-d-yellow/15 text-d-yellow", Icon: Loader2 };
    case "failed":
      return { label: "failed", cls: "bg-d-red/15 text-d-red", Icon: WifiOff };
    case "disconnected":
      return { label: "disconnected", cls: "bg-d-500/20 text-d-300", Icon: WifiOff };
    case "closed":
      return { label: "closed", cls: "bg-d-500/20 text-d-400", Icon: WifiOff };
    default:
      return { label: state, cls: "bg-d-500/20 text-d-300", Icon: Activity };
  }
}

const LEVEL_COLOR: Record<LogLevel, string> = {
  info: "text-d-200",
  net: "text-sky-300",
  warn: "text-d-yellow",
  error: "text-d-red",
};

export default function NetworkPanel() {
  const peers = useAppStore((s) => s.peers);
  const logs = useAppStore((s) => s.logs);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  const peerList = Object.values(peers).sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );

  return (
    <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5">
      {/* Peer cards ------------------------------------------------- */}
      <section className="mb-6">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-d-300">
          Peers on this network
        </h2>

        {peerList.length === 0 ? (
          <div className="rounded-lg border border-dashed border-d-600 bg-d-800/50 px-5 py-10 text-center">
            <Activity size={28} className="mx-auto mb-3 text-d-400" />
            <p className="text-sm text-d-300">
              Searching the local network via mDNS…
            </p>
            <p className="mt-1 text-xs text-d-400">
              Launch a second PeerCord instance on this machine or another device
              in the same subnet.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {peerList.map((peer) => {
              const meta = stateMeta(peer.state);
              const Icon = meta.Icon;
              return (
                <article
                  key={peer.peerId}
                  className="rounded-lg border border-d-700 bg-d-800 p-4 transition-colors hover:border-d-600"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-d-text">
                        {peer.displayName}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-d-400">
                        {peer.peerId.slice(0, 16)}…
                      </div>
                    </div>
                    <span
                      className={clsx(
                        "chip shrink-0",
                        meta.cls,
                      )}
                    >
                      <Icon
                        size={11}
                        className={
                          peer.state === "connecting" ? "animate-spin" : ""
                        }
                      />
                      {meta.label}
                    </span>
                  </div>

                  <dl className="grid grid-cols-2 gap-y-1 text-[11px]">
                    <dt className="text-d-400">Endpoint</dt>
                    <dd className="truncate text-right font-mono text-d-200">
                      {peer.address}:{peer.port}
                    </dd>
                    <dt className="text-d-400">Role</dt>
                    <dd className="text-right text-d-200">
                      {peer.initiator ? "initiator" : "responder"}
                    </dd>
                    <dt className="text-d-400">RTT</dt>
                    <dd className="text-right font-mono text-d-200">
                      {peer.rttMs === null ? "—" : `${peer.rttMs} ms`}
                    </dd>
                  </dl>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Log -------------------------------------------------------- */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-d-300">
          Network log
        </h2>
        <div className="scroll-thin max-h-[38vh] overflow-y-auto rounded-lg border border-d-700 bg-d-950/60 p-3 font-mono text-[11.5px] leading-relaxed">
          {logs.length === 0 ? (
            <div className="text-d-400">waiting for events…</div>
          ) : (
            logs.map((entry) => (
              <div key={entry.id} className="flex gap-2">
                <span className="shrink-0 text-d-500">
                  {new Date(entry.ts).toLocaleTimeString([], {
                    hour12: false,
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
                <span className={clsx("break-all", LEVEL_COLOR[entry.level])}>
                  {entry.text}
                </span>
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </section>
    </div>
  );
}
