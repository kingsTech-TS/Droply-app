import { useSyncExternalStore } from "react";
import { Tabs } from "expo-router";
import { activeSession } from "@/lib/session/registry";
import type { TransfersSnapshot } from "@/lib/webrtc/transfer-manager";
import { isActive } from "@/lib/webrtc/transfer-view";
import { TabBar } from "@/components/tab-bar";

const EMPTY: TransfersSnapshot = { items: [], requests: [], trustedSenders: [] };
const noop = () => () => undefined;

/** Number of transfers in progress (badge on the Transfers tab). */
function useActiveTransferCount(): number {
  const session = useSyncExternalStore(activeSession.subscribe, activeSession.getSnapshot, activeSession.getSnapshot);
  const store = session?.transfers.store;
  const snapshot = useSyncExternalStore(store?.subscribe ?? noop, store?.getSnapshot ?? (() => EMPTY), store?.getSnapshot ?? (() => EMPTY));
  return snapshot.items.filter(isActive).length + snapshot.requests.length;
}

export default function TabsLayout() {
  const active = useActiveTransferCount();
  return (
    <Tabs screenOptions={{ headerShown: false, animation: "shift" }} tabBar={(props) => <TabBar {...props} badges={{ transfers: active }} />}>
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="transfers" options={{ title: "Transfers" }} />
      <Tabs.Screen name="history" options={{ title: "History" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}
