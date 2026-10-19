import { useEffect, useState } from "react";
import NetInfo from "@react-native-community/netinfo";

/** Whether the device has a network connection (the website's navigator.onLine). */
export function useNetworkStatus(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(
    () =>
      NetInfo.addEventListener((state) => {
        setOnline(state.isConnected !== false && state.isInternetReachable !== false);
      }),
    [],
  );
  return online;
}
