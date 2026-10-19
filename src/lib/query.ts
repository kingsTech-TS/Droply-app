// TanStack Query wiring for React Native: refetch when the app returns to the foreground and
// pause while offline (the website gets both from the browser).
import NetInfo from "@react-native-community/netinfo";
import { focusManager, onlineManager } from "@tanstack/react-query";
import { AppState } from "react-native";

let wired = false;

export function wireQueryManagers(): void {
  if (wired) return;
  wired = true;
  focusManager.setEventListener((setFocused) => {
    const sub = AppState.addEventListener("change", (state) => setFocused(state === "active"));
    return () => sub.remove();
  });
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => setOnline(state.isConnected !== false)),
  );
}
