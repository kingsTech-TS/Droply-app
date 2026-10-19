// Confetti, sounds and haptics. All of it is optional (preferences) and respects reduced
// motion, like the website. Visual effects are drawn by <EffectsOverlay/> (Reanimated) from
// the events emitted here; sounds are the website's synthesized sounds rendered to WAV
// (scripts/generate-sounds.mjs); vibration uses the Taptic Engine / Android haptics.
import * as Haptics from "expo-haptics";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { Emitter } from "@/lib/utils/emitter";
import { preferences, prefersReducedMotion } from "./prefs";
import { activeRoomTheme, THEME_STYLES } from "./themes";

export interface ConfettiBurst {
  id: number;
  intensity: "small" | "big";
  colors: readonly string[];
}

export interface FlightPath {
  id: number;
  /** Keys of the two views registered with `registerFlightAnchor` (see use-flight-anchor). */
  from: string;
  to: string;
}

export const effects = new Emitter<{ confetti: ConfettiBurst; fly: FlightPath }>();
let nextId = 1;

/** A short confetti burst over the whole screen. */
export function confetti(intensity: "small" | "big" = "small"): void {
  if (prefersReducedMotion() || !preferences.get().celebrations) return;
  const colors = THEME_STYLES[activeRoomTheme() ?? "default"].confetti;
  effects.emit("confetti", { id: nextId++, intensity, colors });
}

export type SoundName = "send" | "receive" | "request" | "record";

const SOURCES: Record<SoundName, number> = {
  send: require("../../../assets/sounds/send.wav"),
  receive: require("../../../assets/sounds/receive.wav"),
  request: require("../../../assets/sounds/request.wav"),
  record: require("../../../assets/sounds/record.wav"),
};

const players = new Map<SoundName, AudioPlayer>();

/** Short sounds: a rising whoosh for send, a chime for receive. */
export function playSound(name: SoundName): void {
  if (!preferences.get().sound) return;
  try {
    let player = players.get(name);
    if (!player) {
      player = createAudioPlayer(SOURCES[name]);
      players.set(name, player);
    }
    void player.seekTo(0).then(() => player?.play()).catch(() => undefined);
  } catch {
    // Audio is decoration; never let it break anything.
  }
}

/**
 * Same call shape as the website's `navigator.vibrate` patterns. A multi-pulse pattern is a
 * notification ("something arrived"), a single pulse a light tap.
 */
export function vibrate(pattern: number | number[]): void {
  if (!preferences.get().haptics) return;
  const pulses = Array.isArray(pattern) ? Math.ceil(pattern.length / 2) : 1;
  const run =
    pulses >= 2
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  void run.catch(() => undefined);
}

/** UI feedback taps (buttons, toggles, selections). Respects the haptics preference. */
export const haptic = {
  tap(): void {
    if (preferences.get().haptics) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  },
  select(): void {
    if (preferences.get().haptics) void Haptics.selectionAsync().catch(() => undefined);
  },
  success(): void {
    if (preferences.get().haptics) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  },
  warning(): void {
    if (preferences.get().haptics) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
  },
  error(): void {
    if (preferences.get().haptics) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
  },
};

/**
 * The "flight path": a file icon flies between two views (the transfer list → the
 * recipient's card when sending, the sender's card → the list when receiving). Skipped with
 * reduced motion or when celebrations are off; the overlay skips it when either end isn't on
 * screen.
 */
export function flyFile(from: string | null, to: string | null): void {
  if (!from || !to) return;
  if (prefersReducedMotion() || !preferences.get().celebrations) return;
  effects.emit("fly", { id: nextId++, from, to });
}
