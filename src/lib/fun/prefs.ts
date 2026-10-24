import { AccessibilityInfo } from "react-native";
import { isRecord, LocalStore } from "@/lib/utils/local-store";

export interface Preferences {
  /** Whoosh/chime sounds. */
  sound: boolean;
  /** Confetti and other celebrations (also off when the OS asks for reduced motion). */
  celebrations: boolean;
  /** Vibrate on phones when something arrives. */
  haptics: boolean;
  /** System notifications when the tab is in the background (needs permission). */
  notifications: boolean;
  /** Resize large photos before sending. */
  sendSmallerPhotos: boolean;
  /** Save received files by themselves into the Droply folder (no Save button). */
  autoSave: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  sound: true,
  celebrations: true,
  haptics: true,
  notifications: false,
  sendSmallerPhotos: false,
  autoSave: true,
};

export const preferences = new LocalStore<Preferences>("droply:prefs", DEFAULT_PREFERENCES, (raw) => {
  if (!isRecord(raw)) return null;
  const out = { ...DEFAULT_PREFERENCES };
  for (const key of Object.keys(DEFAULT_PREFERENCES) as Array<keyof Preferences>) {
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  }
  return out;
});

// The OS "Reduce motion" setting, kept current by a listener (the API itself is async).
let reducedMotion = false;
void AccessibilityInfo.isReduceMotionEnabled()
  .then((value) => {
    reducedMotion = value;
  })
  .catch(() => undefined);
AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
  reducedMotion = value;
});

export function prefersReducedMotion(): boolean {
  return reducedMotion;
}
