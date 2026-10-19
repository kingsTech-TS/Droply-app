// Transfer history, kept on this device only (website: /history).
import { router } from "expo-router";
import { ArrowDown, ArrowUp, Clock, Trophy } from "lucide-react-native";
import { useMemo, useState } from "react";
import { View } from "react-native";
import Animated, { FadeInDown, LinearTransition } from "react-native-reanimated";
import { clearHistory, history, records, type HistoryEntry } from "@/lib/history/history";
import { formatBytes, formatSpeed } from "@/lib/utils/format";
import { useLocalStore } from "@/hooks/use-local-store";
import { useTheme } from "@/theme/theme-provider";
import { space } from "@/theme/tokens";
import { TAB_BAR_SPACE } from "@/components/tab-bar";
import { FileIcon } from "@/components/transfer/file-icon";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { confirm } from "@/components/ui/confirm";
import { Screen } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";

type Filter = "all" | "outgoing" | "incoming";

function Row({ entry, index }: { entry: HistoryEntry; index: number }) {
  const { colors } = useTheme();
  return (
    <Animated.View entering={FadeInDown.delay(Math.min(index, 10) * 30).springify().damping(18)} layout={LinearTransition} style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm }}>
      <FileIcon name={entry.fileName} mimeType="" size={40} />
      <View style={{ flex: 1 }}>
        <Text variant="callout" numberOfLines={1} style={{ fontWeight: "600" }}>
          {entry.fileName}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          {entry.direction === "outgoing" ? <ArrowUp size={12} color={colors.mutedForeground} /> : <ArrowDown size={12} color={colors.mutedForeground} />}
          <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
            {entry.direction === "outgoing" ? "To" : "From"} {entry.peerName} · {formatBytes(entry.fileSize)}
            {entry.averageSpeed ? ` · ${formatSpeed(entry.averageSpeed)}` : ""}
          </Text>
        </View>
      </View>
      <Text variant="caption" tone="muted">
        {new Date(entry.at).toLocaleDateString([], { month: "short", day: "numeric" })}
      </Text>
    </Animated.View>
  );
}

export default function HistoryScreen() {
  const entries = useLocalStore(history);
  const best = useLocalStore(records);
  const [filter, setFilter] = useState<Filter>("all");
  const list = useMemo(() => entries.filter((e) => filter === "all" || e.direction === filter).slice().reverse(), [entries, filter]);

  const clear = async () => {
    const ok = await confirm({
      title: "Clear your history?",
      message: "Removes the list of past transfers, your records and badges from this device. Files you saved are not affected.",
      confirmLabel: "Clear",
      cancelLabel: "Keep",
      destructive: true,
    });
    if (ok) clearHistory();
  };

  return (
    <Screen
      title="History"
      subtitle="On this device only."
      bottomInset={TAB_BAR_SPACE}
      actions={<Button label="Stats" icon={Trophy} size="sm" variant="tinted" onPress={() => router.push("/stats")} />}
    >
      <Segmented
        accessibilityLabel="Filter"
        options={[
          { value: "all", label: "All" },
          { value: "outgoing", label: "Sent" },
          { value: "incoming", label: "Received" },
        ]}
        value={filter}
        onChange={setFilter}
      />
      {best.bestAverage || best.bestPeak ? (
        <Card tone="primary" level={0} style={{ marginTop: space.lg, gap: 2 }}>
          <Text variant="overline" tone="primary">
            Personal records
          </Text>
          <Text variant="footnote">
            {best.bestPeak ? `Top speed ${formatSpeed(best.bestPeak)}` : ""}
            {best.bestAverage ? ` · best average ${formatSpeed(best.bestAverage)}` : ""}
            {best.biggestFile ? ` · biggest file ${formatBytes(best.biggestFile)}` : ""}
          </Text>
        </Card>
      ) : null}
      {list.length === 0 ? (
        <EmptyState icon={Clock} title="No transfers yet" body="They'll show up here, on this device only." />
      ) : (
        <Card style={{ marginTop: space.lg, paddingVertical: space.sm }}>
          {list.map((e, i) => (
            <Row key={e.id} entry={e} index={i} />
          ))}
        </Card>
      )}
      {entries.length > 0 ? <Button label="Clear history" variant="ghost" onPress={() => void clear()} style={{ marginTop: space.lg }} /> : null}
    </Screen>
  );
}
