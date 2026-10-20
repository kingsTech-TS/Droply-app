// The two big actions (the website's drop zone + "Create an empty room to receive"), plus
// "Host an event" and "Speed test".
import { router } from "expo-router";
import { ArrowDownToLine, Gauge, PartyPopper, Send } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { userMessage } from "@/lib/api/errors";
import type { LocalFile } from "@/lib/files/local-file";
import { startRoom } from "@/lib/session/actions";
import { useDevice } from "@/hooks/use-device";
import { useLocalStore } from "@/hooks/use-local-store";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useTheme } from "@/theme/theme-provider";
import { alpha, elevation, radius, space } from "@/theme/tokens";
import type { RoomKind } from "@/types/room";
import { AddFilesSheet } from "@/components/transfer/add-files-sheet";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";
import { toast } from "@/components/ui/toast";
import { createDuration, DurationPicker } from "./duration-picker";
import { goToRoom } from "./home-sections";
import { createTheme, ThemePicker } from "./theme-picker";

function Tile({
  title,
  subtitle,
  icon: Icon,
  primary,
  busy,
  onPress,
}: {
  title: string;
  subtitle: string;
  icon: typeof Send;
  primary?: boolean;
  busy?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const shine = useSharedValue(0);
  useEffect(() => {
    if (primary && !reduced) shine.value = withRepeat(withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.quad) }), -1, false);
  }, [primary, reduced, shine]);
  const shineStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -160 + shine.value * 520 }, { rotate: "20deg" }] }));
  const fg = primary ? colors.primaryForeground : colors.primary;
  return (
    <PressableScale onPress={onPress} disabled={busy} scaleTo={0.95} accessibilityLabel={title} accessibilityHint={subtitle} style={[styles.tile, elevation(primary ? 2 : 1, colors)]}>
      {primary ? (
        <LinearGradient colors={[colors.primary, colors.electric]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.primarySoft, borderRadius: radius.xxl }]} />
      )}
      {primary ? (
        <Animated.View style={[styles.shine, shineStyle]} pointerEvents="none">
          <LinearGradient colors={[alpha("#ffffff", 0), alpha("#ffffff", 0.22), alpha("#ffffff", 0)]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
        </Animated.View>
      ) : null}
      <View style={[styles.tileIcon, { backgroundColor: primary ? alpha("#ffffff", 0.2) : colors.primarySoft }]}>
        {busy ? <ActivityIndicator color={fg} /> : <Icon size={26} color={fg} strokeWidth={2.3} />}
      </View>
      <View style={{ gap: 2 }}>
        <Text variant="headline" color={primary ? colors.primaryForeground : colors.foreground}>
          {title}
        </Text>
        <Text variant="footnote" color={primary ? alpha(colors.primaryForeground, 0.85) : colors.mutedForeground} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
    </PressableScale>
  );
}

export function StartTiles() {
  const { info } = useDevice();
  const theme = useLocalStore(createTheme);
  const minutes = useLocalStore(createDuration);
  const [busy, setBusy] = useState<"send" | "receive" | "event" | null>(null);
  const [picking, setPicking] = useState(false);

  const start = async (which: "send" | "receive" | "event", files: LocalFile[] = [], kind: RoomKind = "standard") => {
    if (busy) return;
    setBusy(which);
    try {
      goToRoom(await startRoom(info(), { files, kind, theme, durationMinutes: minutes }));
    } catch (error) {
      toast.error(userMessage(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ gap: space.lg }}>
      <View style={styles.tiles}>
        <Tile title="Send" subtitle="Pick files, then a device" icon={Send} primary busy={busy === "send"} onPress={() => setPicking(true)} />
        <Tile title="Receive" subtitle="Open a room for others" icon={ArrowDownToLine} busy={busy === "receive"} onPress={() => void start("receive")} />
      </View>
      <ThemePicker value={theme} onChange={(t) => createTheme.set(t)} disabled={busy !== null} />
      <DurationPicker value={minutes} onChange={(m) => createDuration.set(m)} disabled={busy !== null} />
      <View style={styles.links}>
        <Button label="Host an event" icon={PartyPopper} size="sm" variant="ghost" onPress={() => void start("event", [], "event")} disabled={busy !== null} />
        <Button label="Speed test" icon={Gauge} size="sm" variant="ghost" onPress={() => router.push("/speed-test")} disabled={busy !== null} />
      </View>
      <AddFilesSheet visible={picking} onClose={() => setPicking(false)} title="Send files" onFiles={(files) => void start("send", files)} />
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: "row", gap: space.md },
  tile: { flex: 1, minHeight: 150, borderRadius: radius.xxl, padding: space.lg, justifyContent: "space-between", overflow: "hidden" },
  tileIcon: { width: 50, height: 50, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  shine: { position: "absolute", top: -60, bottom: -60, width: 90 },
  links: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: space.xs },
});
