/**
 * Global UI state (Zustand).
 * Everything network-related lives in services/ — the store only mirrors it.
 */
import { create } from "zustand";
import type {
  LogEntry,
  LogLevel,
  NodeInfo,
  PeerRecord,
} from "../lib/types";

const MAX_LOGS = 400;

interface AppState {
  /* identity */
  selfId: string;
  selfName: string;
  nodeInfo: NodeInfo | null;
  ready: boolean;

  /* peers */
  peers: Record<string, PeerRecord>;

  /* ui */
  activeChannel: string;
  logs: LogEntry[];

  /* actions */
  setIdentity: (id: string, name: string) => void;
  setNodeInfo: (info: NodeInfo) => void;
  setReady: (ready: boolean) => void;
  upsertPeer: (peer: PeerRecord) => void;
  patchPeer: (peerId: string, patch: Partial<PeerRecord>) => void;
  removePeer: (peerId: string) => void;
  setActiveChannel: (channel: string) => void;
  log: (text: string, level?: LogLevel) => void;
  clearLogs: () => void;
}

let logCounter = 0;

export const useAppStore = create<AppState>((set) => ({
  selfId: "",
  selfName: "",
  nodeInfo: null,
  ready: false,
  peers: {},
  activeChannel: "network",
  logs: [],

  setIdentity: (selfId, selfName) => set({ selfId, selfName }),
  setNodeInfo: (nodeInfo) => set({ nodeInfo }),
  setReady: (ready) => set({ ready }),

  upsertPeer: (peer) =>
    set((state) => ({
      peers: { ...state.peers, [peer.peerId]: { ...state.peers[peer.peerId], ...peer } },
    })),

  patchPeer: (peerId, patch) =>
    set((state) => {
      const current = state.peers[peerId];
      if (!current) return state;
      return { peers: { ...state.peers, [peerId]: { ...current, ...patch } } };
    }),

  removePeer: (peerId) =>
    set((state) => {
      const next = { ...state.peers };
      delete next[peerId];
      return { peers: next };
    }),

  setActiveChannel: (activeChannel) => set({ activeChannel }),

  log: (text, level = "info") =>
    set((state) => {
      const entry: LogEntry = {
        id: `${Date.now()}-${logCounter++}`,
        ts: Date.now(),
        level,
        text,
      };
      const logs = [...state.logs, entry];
      return { logs: logs.length > MAX_LOGS ? logs.slice(-MAX_LOGS) : logs };
    }),

  clearLogs: () => set({ logs: [] }),
}));
