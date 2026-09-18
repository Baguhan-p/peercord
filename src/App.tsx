/**
 * App shell — Discord-like four-column layout.
 * Switches the centre panel between the network view and chat panels.
 */
import { useEffect } from "react";
import ServerRail from "./components/ServerRail";
import ChannelSidebar from "./components/ChannelSidebar";
import TopBar from "./components/TopBar";
import NetworkPanel from "./components/NetworkPanel";
import ChatPanel from "./components/ChatPanel";
import MemberSidebar from "./components/MemberSidebar";
import StatusBar from "./components/StatusBar";
import { bootstrap, teardown } from "./services/bootstrap";
import { useAppStore } from "./store/useAppStore";
import { isChatChannel } from "./lib/types";

export default function App() {
  useEffect(() => {
    void bootstrap();
    return () => teardown();
  }, []);

  const activeChannel = useAppStore((s) => s.activeChannel);
  const showChat = isChatChannel(activeChannel);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-d-900 text-d-text">
      <ServerRail />
      <ChannelSidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        {showChat ? <ChatPanel /> : <NetworkPanel />}
        <StatusBar />
      </main>
      <MemberSidebar />
    </div>
  );
}
