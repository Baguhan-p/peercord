/**
 * App shell — Discord-like four-column layout.
 * Phase 1 renders the Network workspace; chat/voice land in later phases.
 */
import { useEffect } from "react";
import ServerRail from "./components/ServerRail";
import ChannelSidebar from "./components/ChannelSidebar";
import TopBar from "./components/TopBar";
import NetworkPanel from "./components/NetworkPanel";
import MemberSidebar from "./components/MemberSidebar";
import StatusBar from "./components/StatusBar";
import { bootstrap, teardown } from "./services/bootstrap";

export default function App() {
  useEffect(() => {
    void bootstrap();
    return () => teardown();
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-d-900 text-d-text">
      <ServerRail />
      <ChannelSidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <NetworkPanel />
        <StatusBar />
      </main>
      <MemberSidebar />
    </div>
  );
}
