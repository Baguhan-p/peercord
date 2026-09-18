/** Left-most vertical rail with "spaces" (single local space in Phase 1). */
import { Compass, Plus, Radio } from "lucide-react";
import clsx from "clsx";

export default function ServerRail() {
  return (
    <nav className="flex w-[72px] shrink-0 flex-col items-center gap-2 bg-d-950 py-3">
      <div
        className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-d-accent text-white shadow-lg"
        title="PeerCord (local space)"
      >
        <Radio size={22} strokeWidth={2.4} />
      </div>

      <div className="my-1 h-px w-8 bg-d-700" />

      <button className="rail-item" title="Discover peers">
        <Compass size={22} />
      </button>

      <button className="rail-item" title="Create space (Phase 2)">
        <Plus size={22} />
      </button>

      <div className="flex-1" />

      <div
        className={clsx(
          "flex h-10 w-10 items-center justify-center rounded-full",
          "bg-d-700 text-d-300 text-xs font-semibold",
        )}
        title="PeerCord v0.1.0 — Phase 1"
      >
        v1
      </div>
    </nav>
  );
}
