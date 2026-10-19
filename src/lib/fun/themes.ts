import { Store } from "@/lib/utils/emitter";
import type { RoomTheme } from "@/types/room";

// Room themes. The colors live in src/theme/tokens.ts (per-theme overrides of the design
// tokens); the ThemeProvider subscribes to `roomThemeStore`, so every screen, sheet and toast
// follows the theme automatically.

export interface ThemeStyle {
  label: string;
  emoji: string;
  /** One line under the room title. */
  tagline: string;
  /** Confetti colors for celebrations in this room. */
  confetti: readonly string[];
}

export const THEME_STYLES: Record<RoomTheme, ThemeStyle> = {
  default: {
    label: "Classic",
    emoji: "⚡",
    tagline: "Fast, private, direct.",
    confetti: ["#7c5cff", "#3b82f6", "#22c55e", "#f59e0b", "#ec4899", "#06b6d4"],
  },
  party: {
    label: "Party",
    emoji: "🎉",
    tagline: "Drop the party pics here.",
    confetti: ["#d946ef", "#a855f7", "#f59e0b", "#22d3ee", "#f43f5e"],
  },
  birthday: {
    label: "Birthday",
    emoji: "🎂",
    tagline: "Share the birthday memories.",
    confetti: ["#ec4899", "#f43f5e", "#fb923c", "#fde047", "#c084fc"],
  },
  wedding: {
    label: "Wedding",
    emoji: "💍",
    tagline: "Every photo from the big day, in one place.",
    confetti: ["#d4af37", "#f5e6c8", "#f9a8d4", "#ffffff", "#e7c27d"],
  },
  gaming: {
    label: "Gaming",
    emoji: "🎮",
    tagline: "Clips, mods and saves. GG.",
    confetti: ["#10b981", "#22d3ee", "#a3e635", "#8b5cf6", "#f43f5e"],
  },
  study: {
    label: "Study",
    emoji: "📚",
    tagline: "Notes, slides and worksheets.",
    confetti: ["#3b82f6", "#6366f1", "#38bdf8", "#facc15", "#94a3b8"],
  },
  ocean: {
    label: "Ocean",
    emoji: "🌊",
    tagline: "Calm waters, fast files.",
    confetti: ["#06b6d4", "#0ea5e9", "#2dd4bf", "#e0f2fe", "#1d4ed8"],
  },
  sunset: {
    label: "Sunset",
    emoji: "🌅",
    tagline: "Golden hour, golden files.",
    confetti: ["#f97316", "#fb7185", "#f59e0b", "#e11d48", "#fde68a"],
  },
};

/** The theme applied app-wide while a themed room is open (null otherwise). */
export const roomThemeStore = new Store<RoomTheme | null>(null);

export function activeRoomTheme(): RoomTheme | null {
  return roomThemeStore.getSnapshot();
}

/** Applies a theme to the whole app, or removes it for "default"/null. */
export function applyRoomTheme(theme: RoomTheme | null): void {
  roomThemeStore.set(theme && theme !== "default" ? theme : null);
}
