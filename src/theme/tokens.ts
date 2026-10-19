// Design tokens: the website's palette (light/dark + room themes) plus the app's spacing,
// radii, type scale and elevation. Components read these through useTheme().
import { Platform, type TextStyle, type ViewStyle } from "react-native";
import type { RoomTheme } from "@/types/room";
import { PALETTE } from "./palette.generated";

export type ColorScheme = "light" | "dark";

type Base = (typeof PALETTE)["light"];
export type Colors = { -readonly [K in keyof Base]: string } & {
  /** Translucent tints derived from the main colors, for chips, halos and pressed states. */
  primarySoft: string;
  electricSoft: string;
  successSoft: string;
  warningSoft: string;
  destructiveSoft: string;
  overlay: string;
  shadow: string;
};

/** "#rrggbb" + alpha (0–1) → "#rrggbbaa". */
export function alpha(hex: string, value: number): string {
  const a = Math.round(Math.min(1, Math.max(0, value)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex.slice(0, 7)}${a}`;
}

export function buildColors(scheme: ColorScheme, roomTheme: RoomTheme | null): Colors {
  const base: Record<string, string> = { ...PALETTE[scheme] };
  if (roomTheme && roomTheme !== "default") Object.assign(base, PALETTE.rooms[roomTheme][scheme]);
  const c = base as { -readonly [K in keyof Base]: string };
  const dark = scheme === "dark";
  return {
    ...c,
    primarySoft: alpha(c.primary, dark ? 0.18 : 0.1),
    electricSoft: alpha(c.electric, dark ? 0.18 : 0.12),
    successSoft: alpha(c.success, dark ? 0.18 : 0.12),
    warningSoft: alpha(c.warning, dark ? 0.2 : 0.14),
    destructiveSoft: alpha(c.destructive, dark ? 0.2 : 0.1),
    overlay: dark ? "rgba(0,0,0,0.6)" : "rgba(15,18,35,0.4)",
    shadow: dark ? "#000000" : "#1b2245",
  };
}

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 22, xxl: 28, pill: 999 } as const;

/** Minimum touch target (Apple HIG 44pt, Material 48dp). */
export const TOUCH = 48;

const family = Platform.select({ ios: "System", default: undefined });

export const type = {
  display: { fontFamily: family, fontSize: 34, lineHeight: 40, fontWeight: "800", letterSpacing: -0.8 },
  title: { fontFamily: family, fontSize: 28, lineHeight: 34, fontWeight: "800", letterSpacing: -0.5 },
  headline: { fontFamily: family, fontSize: 20, lineHeight: 26, fontWeight: "700", letterSpacing: -0.3 },
  subhead: { fontFamily: family, fontSize: 17, lineHeight: 22, fontWeight: "600", letterSpacing: -0.2 },
  body: { fontFamily: family, fontSize: 16, lineHeight: 22, fontWeight: "400" },
  bodyStrong: { fontFamily: family, fontSize: 16, lineHeight: 22, fontWeight: "600" },
  callout: { fontFamily: family, fontSize: 15, lineHeight: 20, fontWeight: "400" },
  footnote: { fontFamily: family, fontSize: 13, lineHeight: 18, fontWeight: "400" },
  caption: { fontFamily: family, fontSize: 12, lineHeight: 16, fontWeight: "500" },
  overline: { fontFamily: family, fontSize: 12, lineHeight: 16, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
  mono: { fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), fontSize: 15, lineHeight: 20, fontWeight: "600" },
  code: { fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), fontSize: 40, lineHeight: 48, fontWeight: "700", letterSpacing: 4 },
} satisfies Record<string, TextStyle>;

export type TypeVariant = keyof typeof type;

/** Soft elevation that reads well on both themes. */
export function elevation(level: 0 | 1 | 2 | 3, colors: Colors): ViewStyle {
  if (level === 0) return {};
  const config = { 1: [2, 6, 0.06, 2], 2: [6, 16, 0.1, 5], 3: [12, 28, 0.16, 10] }[level];
  return {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: config[0]! },
    shadowRadius: config[1]!,
    shadowOpacity: config[2]!,
    elevation: config[3]!,
  };
}

/** Spring presets shared by every animation, so motion feels consistent. */
export const springs = {
  snappy: { damping: 18, stiffness: 260, mass: 0.8 },
  gentle: { damping: 20, stiffness: 140, mass: 1 },
  bouncy: { damping: 11, stiffness: 180, mass: 0.9 },
} as const;
