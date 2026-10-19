// "Your room is ready" / "Add another device": room code (copy), copy link, QR, Invite
// (share sheet), Present (full screen), expiry countdown and host settings. Collapsible,
// open by default while this device is alone (website: room-share-panel.tsx).
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { Check, ChevronDown, Copy, Link2, Maximize, QrCode as QrIcon, Radar, Share2 } from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, Share, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition, useAnimatedStyle, withTiming } from "react-native-reanimated";
import { brand } from "@/config/brand";
import { haptic } from "@/lib/fun/celebrate";
import { THEME_STYLES } from "@/lib/fun/themes";
import { formatRoomCode } from "@/lib/utils/format";
import { userMessage } from "@/lib/api/errors";
import { useTheme } from "@/theme/theme-provider";
import { radius, space, type } from "@/theme/tokens";
import { ROOM_THEMES, type RoomTheme } from "@/types/room";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { SwitchRow } from "@/components/ui/switch-row";
import { Text } from "@/components/ui/text";
import { toast } from "@/components/ui/toast";
import { QrCode } from "./qr-code";
import { RoomCountdown } from "./room-banners";

function CopyButton({ label, value, icon }: { label: string; value: string; icon: typeof Copy }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <Button
      label={copied ? "Copied" : label}
      icon={copied ? Check : icon}
      size="sm"
      variant="outline"
      onPress={() => {
        void Clipboard.setStringAsync(value).then(() => {
          haptic.success();
          setCopied(true);
        });
      }}
    />
  );
}

export function RoomSettings({ theme, discoverable, onTheme, onDiscoverable }: { theme: RoomTheme; discoverable: boolean; onTheme: (t: RoomTheme) => Promise<void>; onDiscoverable: (v: boolean) => Promise<void> }) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      toast.error(userMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: space.md, alignSelf: "stretch" }}>
      <Text variant="overline" tone="muted">
        Room theme
      </Text>
      <View style={styles.themes}>
        {ROOM_THEMES.map((t) => {
          const selected = theme === t;
          return (
            <PressableScale
              key={t}
              disabled={busy}
              hapticFeedback="select"
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => void run(() => onTheme(t))}
              style={[styles.themeChip, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primarySoft : colors.card }]}
            >
              <Text>{THEME_STYLES[t].emoji}</Text>
              <Text variant="footnote" tone={selected ? "primary" : "default"} style={{ fontWeight: selected ? "700" : "500" }}>
                {THEME_STYLES[t].label}
              </Text>
            </PressableScale>
          );
        })}
      </View>
      <SwitchRow
        icon={Radar}
        label="Visible to nearby devices"
        hint="Devices on the same internet connection can join without the code. Turn off in public Wi-Fi."
        value={discoverable}
        disabled={busy}
        onChange={(v) => void run(() => onDiscoverable(v))}
      />
    </View>
  );
}

export interface RoomShareCardProps {
  code: string;
  joinUrl: string;
  expiresAt: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings?: ReactNode;
}

export function RoomShareCard({ code, joinUrl, expiresAt, open, onOpenChange, settings }: RoomShareCardProps) {
  const { colors } = useTheme();
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: withTiming(open ? "180deg" : "0deg", { duration: 200 }) }] }));
  const invite = async () => {
    try {
      await Share.share({ title: `Join my ${brand.name} room`, message: `Join my ${brand.name} room with code ${code}: ${joinUrl}`, url: joinUrl });
    } catch {
      // The user closed the share sheet.
    }
  };
  return (
    <Animated.View layout={LinearTransition.springify().damping(20)}>
      <Card padded={false}>
        <Pressable
          onPress={() => {
            haptic.select();
            onOpenChange(!open);
          }}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          style={styles.trigger}
        >
          <View style={[styles.triggerIcon, { backgroundColor: colors.primarySoft }]}>
            <QrIcon size={18} color={colors.primary} />
          </View>
          <Text variant="subhead" style={{ flex: 1 }}>
            {open ? "Your room is ready" : "Add another device"}
          </Text>
          {!open ? (
            <Text variant="mono" tone="muted" style={{ fontSize: 14 }}>
              {formatRoomCode(code)}
            </Text>
          ) : null}
          <Animated.View style={chevron}>
            <ChevronDown size={20} color={colors.mutedForeground} />
          </Animated.View>
        </Pressable>
        {open ? (
          <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(150)} style={styles.body}>
            <Text variant="overline" tone="muted">
              Room code
            </Text>
            <Text style={[type.code, { color: colors.foreground }]} accessibilityLabel={`Room code ${code.split("").join(" ")}`} selectable>
              {formatRoomCode(code)}
            </Text>
            <View style={styles.row}>
              <CopyButton label="Copy code" value={code} icon={Copy} />
              <CopyButton label="Copy link" value={joinUrl} icon={Link2} />
            </View>
            <View style={styles.or}>
              <View style={[styles.rule, { backgroundColor: colors.border }]} />
              <Text variant="footnote" tone="muted">
                or
              </Text>
              <View style={[styles.rule, { backgroundColor: colors.border }]} />
            </View>
            <QrCode value={joinUrl} size={176} />
            <Text variant="footnote" tone="muted" center>
              Scan this QR code with another device, or open the link and enter the code.
            </Text>
            <View style={styles.row}>
              <Button label="Invite" icon={Share2} size="sm" variant="secondary" onPress={() => void invite()} />
              <Button label="Present" icon={Maximize} size="sm" variant="outline" onPress={() => router.push("/present")} />
            </View>
            <RoomCountdown expiresAt={expiresAt} />
            {settings ? <View style={[styles.settings, { borderTopColor: colors.border }]}>{settings}</View> : null}
          </Animated.View>
        ) : null}
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  trigger: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg, minHeight: 60 },
  triggerIcon: { width: 34, height: 34, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  body: { alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.lg },
  row: { flexDirection: "row", gap: space.sm, flexWrap: "wrap", justifyContent: "center" },
  or: { flexDirection: "row", alignItems: "center", gap: space.md, alignSelf: "stretch" },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  settings: { alignSelf: "stretch", borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.lg, marginTop: space.sm },
  themes: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  themeChip: { flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1.5 },
});
