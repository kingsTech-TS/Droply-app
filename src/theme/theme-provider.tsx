// Light/dark/system theme (like the website's theme toggle) plus the live room theme: while a
// themed room is open, every screen, sheet and toast uses its colors.
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import * as SystemUI from "expo-system-ui";
import { roomThemeStore } from "@/lib/fun/themes";
import { LocalStore } from "@/lib/utils/local-store";
import { useLocalStore } from "@/hooks/use-local-store";
import { buildColors, type ColorScheme, type Colors } from "./tokens";

export type ThemePreference = "system" | "light" | "dark";

export const themePreference = new LocalStore<ThemePreference>("droply:theme", "system", (raw) =>
  raw === "light" || raw === "dark" || raw === "system" ? raw : null,
);

interface ThemeValue {
  colors: Colors;
  scheme: ColorScheme;
  preference: ThemePreference;
  setPreference: (value: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const preference = useLocalStore(themePreference);
  const roomTheme = useSyncExternalStore(roomThemeStore.subscribe, roomThemeStore.getSnapshot, roomThemeStore.getSnapshot);
  const scheme: ColorScheme = preference === "system" ? (system === "dark" ? "dark" : "light") : preference;
  const colors = useMemo(() => buildColors(scheme, roomTheme), [scheme, roomTheme]);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background).catch(() => undefined);
  }, [colors.background]);

  const value = useMemo<ThemeValue>(
    () => ({ colors, scheme, preference, setPreference: (v) => themePreference.set(v) }),
    [colors, scheme, preference],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider");
  return value;
}
