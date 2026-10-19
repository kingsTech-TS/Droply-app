// "Droply Wrapped": personal stats and badges, computed on the device (website: /stats).
import { Share2 } from "lucide-react-native";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeInDown, ZoomIn } from "react-native-reanimated";
import { badges, history, records, stats } from "@/lib/history/history";
import { formatBytes, formatSpeed } from "@/lib/utils/format";
import type { FileKind } from "@/lib/utils/file-kind";
import { useLocalStore } from "@/hooks/use-local-store";
import { useTheme } from "@/theme/theme-provider";
import { radius, space } from "@/theme/tokens";
import { shareResultCard } from "@/components/share/result-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import { SectionHeader } from "@/components/ui/states";
import { Text } from "@/components/ui/text";

const KIND_LABEL: Record<FileKind, string> = {
  video: "videos",
  image: "photos",
  audio: "audio",
  archive: "archives",
  pdf: "PDFs",
  document: "documents",
  spreadsheet: "spreadsheets",
  presentation: "presentations",
  code: "code",
  other: "files",
};

function hourLabel(hour: number): string {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.toLocaleTimeString([], { hour: "numeric" });
}

export default function StatsScreen() {
  const { colors } = useTheme();
  const entries = useLocalStore(history);
  const best = useLocalStore(records);
  const [range, setRange] = useState<"month" | "all">("month");
  const since = useMemo(() => {
    if (range === "all") return 0;
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  }, [range]);
  const s = useMemo(() => stats(entries, since), [entries, since]);
  const earned = useMemo(() => badges(entries, best), [entries, best]);

  const share = () =>
    void shareResultCard(
      {
        headline: `${range === "month" ? "This month" : "So far"} I moved ${formatBytes(s.bytes)}`,
        detail: `${s.files} files · ${s.devices} devices${s.fastest ? ` · top ${formatSpeed(s.fastest)}` : ""}`,
        footer:
          earned
            .filter((b) => b.earned)
            .map((b) => b.emoji)
            .join(" ")
            .trim() || undefined,
      },
      `My Droply stats: ${formatBytes(s.bytes)} moved ⚡`,
    );

  const tiles: Array<[string, string]> = [
    ["Moved", formatBytes(s.bytes)],
    ["Files", s.files.toLocaleString()],
    ["Devices", s.devices.toLocaleString()],
    ["Top speed", formatSpeed(s.fastest)],
    ["Mostly", s.topKind ? KIND_LABEL[s.topKind] : "—"],
    ["Busiest time", s.busiestHour !== null ? hourLabel(s.busiestHour) : "—"],
  ];

  return (
    <Screen title="Stats & badges" subtitle="Computed on this device from your history." back actions={<Button label="Share" icon={Share2} size="sm" variant="tinted" onPress={share} disabled={s.files === 0} />}>
      <Segmented
        accessibilityLabel="Period"
        options={[
          { value: "month", label: "This month" },
          { value: "all", label: "All time" },
        ]}
        value={range}
        onChange={setRange}
      />
      <View style={styles.tiles}>
        {tiles.map(([label, value], i) => (
          <Animated.View key={`${range}-${label}`} entering={ZoomIn.delay(i * 40).springify().damping(16)} style={styles.tileWrap}>
            <Card style={{ gap: 2 }}>
              <Text variant="caption" tone="muted">
                {label}
              </Text>
              <Text variant="headline" numberOfLines={1} adjustsFontSizeToFit>
                {value}
              </Text>
            </Card>
          </Animated.View>
        ))}
      </View>
      {s.files > 0 ? (
        <Text variant="footnote" tone="muted" center>
          Sent {formatBytes(s.sentBytes)} · received {formatBytes(s.receivedBytes)}.
        </Text>
      ) : null}
      <SectionHeader title="Badges" />
      <View style={{ gap: space.sm }}>
        {earned.map((b, i) => (
          <Animated.View key={b.id} entering={FadeInDown.delay(i * 40).springify().damping(18)}>
            <Card level={b.earned ? 1 : 0} tone={b.earned ? "default" : "muted"} style={[styles.badge, { opacity: b.earned ? 1 : 0.6 }]}>
              <View style={[styles.badgeEmoji, { backgroundColor: b.earned ? colors.primarySoft : colors.muted }]}>
                <Text style={{ fontSize: 26, opacity: b.earned ? 1 : 0.5 }}>{b.emoji}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong" accessibilityLabel={`${b.title}${b.earned ? ", earned" : ", not earned yet"}`}>
                  {b.title}
                </Text>
                <Text variant="footnote" tone="muted">
                  {b.description}
                </Text>
              </View>
            </Card>
          </Animated.View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginVertical: space.lg },
  tileWrap: { width: "48.5%" },
  badge: { flexDirection: "row", alignItems: "center", gap: space.md },
  badgeEmoji: { width: 48, height: 48, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
});
