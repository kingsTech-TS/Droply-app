// Local notifications for incoming files, texts and pairing requests while Droply is in the
// background (the website uses the Notifications API while its tab is hidden). Nothing is
// sent through a push service: notifications are posted by the app itself.
import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";
import { preferences } from "@/lib/fun/prefs";
import { logger } from "@/lib/utils/logger";

let configured = false;

export function configureNotifications(): void {
  if (configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    // In the foreground the app shows its own UI (toasts, sheets) instead.
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === "android") {
    void Notifications.setNotificationChannelAsync("transfers", {
      name: "Transfers",
      // Re-exported with export * (the import plugin can't see it); it exists at runtime.
      // eslint-disable-next-line import/namespace
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 40, 40, 40],
      lightColor: "#4F46E5",
    }).catch(() => undefined);
  }
}

/** Asks for permission (from the preference toggle). Returns whether it's granted. */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const next = await Notifications.requestPermissionsAsync();
    return next.granted;
  } catch {
    return false;
  }
}

/** Posts a notification if the preference is on and the app isn't in the foreground. */
export function notifyInBackground(title: string, body: string, data: Record<string, string> = {}): void {
  if (!preferences.get().notifications || AppState.currentState === "active") return;
  void Notifications.scheduleNotificationAsync({
    content: { title, body, data, ...(Platform.OS === "android" ? { channelId: "transfers" } : {}) },
    trigger: null,
  }).catch((error: unknown) => logger.debug("notify", "failed", String(error)));
}
