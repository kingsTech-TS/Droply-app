// Device-to-device speed test with synthetic data (website: speed-test-dialog.tsx).
import { Gauge, Share2 } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { confetti, playSound } from "@/lib/fun/celebrate";
import { records } from "@/lib/history/history";
import { formatBytes, formatDuration, formatSpeed } from "@/lib/utils/format";
import type { LinkInfo } from "@/lib/webrtc/peer-connection";
import type { SpeedTestResult } from "@/lib/webrtc/transfer-manager";
import { useTheme } from "@/theme/theme-provider";
import { radius, space } from "@/theme/tokens";
import { SpeedGauge } from "@/components/motion/speed-graphics";
import { shareResultCard } from "@/components/share/result-card";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { Text } from "@/components/ui/text";
import { toast } from "@/components/ui/toast";

const SIZES = [
  { label: "Quick", bytes: 32 * 1024 * 1024 },
  { label: "Standard", bytes: 128 * 1024 * 1024 },
  { label: "Long", bytes: 256 * 1024 * 1024 },
] as const;

const PATH_LABEL: Record<LinkInfo["path"], string> = {
  lan: "Direct (local network)",
  direct: "Direct (internet)",
  relay: "Relay",
  unknown: "Unknown",
};

export interface SpeedTestSheetProps {
  visible: boolean;
  onClose: () => void;
  peerName: string;
  link: LinkInfo | undefined;
  run: (bytes: number, onProgress: (verified: number, speed: number | null) => void) => Promise<SpeedTestResult>;
}

export function SpeedTestSheet({ visible, onClose, peerName, link, run }: SpeedTestSheetProps) {
  const { colors } = useTheme();
  const [size, setSize] = useState<string>(String(SIZES[1].bytes));
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState<{ verified: number; speed: number | null } | null>(null);
  const [result, setResult] = useState<SpeedTestResult | null>(null);
  const bytes = Number(size);

  const start = async () => {
    setRunning(true);
    setResult(null);
    setLive({ verified: 0, speed: null });
    const best = records.get().bestPeak;
    const outcome = await run(bytes, (verified, speed) => setLive({ verified, speed }));
    setRunning(false);
    setResult(outcome);
    if (!outcome.ok) {
      toast.error("The speed test didn't finish. Check the connection and try again.");
      return;
    }
    playSound("receive");
    if (outcome.peakSpeed && best !== null && outcome.peakSpeed > best) {
      records.update((r) => ({ ...r, bestPeak: outcome.peakSpeed }));
      confetti("big");
      playSound("record");
      toast.success(`New personal record: ${formatSpeed(outcome.peakSpeed)}!`);
    } else if (outcome.peakSpeed && best === null) {
      records.update((r) => ({ ...r, bestPeak: outcome.peakSpeed }));
    }
  };

  const share = () => {
    if (!result?.averageSpeed) return;
    void shareResultCard(
      { headline: `${formatSpeed(result.averageSpeed)} between my devices`, detail: `Top ${formatSpeed(result.peakSpeed)} · ${link ? PATH_LABEL[link.path] : "Peer to peer"}` },
      `My devices talk at ${formatSpeed(result.averageSpeed)} with Droply ⚡`,
    );
  };

  const speed = running ? (live?.speed ?? null) : (result?.averageSpeed ?? null);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      locked={running}
      icon={Gauge}
      title={`Speed test with ${peerName}`}
      subtitle="Sends test data over your connection and throws it away. No files are touched."
      footer={
        <View style={{ flexDirection: "row", gap: space.sm }}>
          {result?.ok ? <Button label="Share result" icon={Share2} variant="outline" onPress={share} style={{ flex: 1 }} /> : null}
          <Button label={running ? "Testing…" : result ? "Test again" : "Start test"} onPress={() => void start()} disabled={running} loading={running} style={{ flex: 1 }} />
        </View>
      }
    >
      <View style={styles.gauge}>
        <SpeedGauge speed={speed} size={220} />
        <Text variant="title" style={{ fontVariant: ["tabular-nums"] }} accessibilityLiveRegion="polite">
          {formatSpeed(speed)}
        </Text>
        <Text variant="footnote" tone="muted">
          {link && link.status === "connected" ? PATH_LABEL[link.path] : "Connecting…"}
          {link?.rttMs != null ? ` · ${link.rttMs} ms latency` : ""}
        </Text>
      </View>
      {running && live ? <ProgressBar value={live.verified / bytes} active accessibilityLabel="Speed test progress" /> : null}
      {result?.ok ? (
        <Animated.View entering={FadeIn} style={[styles.results, { backgroundColor: colors.muted }]}>
          {[
            ["Average", formatSpeed(result.averageSpeed)],
            ["Top", formatSpeed(result.peakSpeed)],
            ["Sent", `${formatBytes(result.bytes)} in ${formatDuration(result.seconds)}`],
          ].map(([label, value]) => (
            <View key={label} style={{ flex: 1, alignItems: "center" }}>
              <Text variant="caption" tone="muted">
                {label}
              </Text>
              <Text variant="footnote" style={{ fontWeight: "700" }} center>
                {value}
              </Text>
            </View>
          ))}
        </Animated.View>
      ) : null}
      {!running ? (
        <Segmented
          accessibilityLabel="Test size"
          options={SIZES.map((s) => ({ value: String(s.bytes), label: `${s.label} · ${formatBytes(s.bytes)}` }))}
          value={size}
          onChange={setSize}
        />
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  gauge: { alignItems: "center", gap: space.xs, paddingVertical: space.sm },
  results: { flexDirection: "row", padding: space.md, borderRadius: radius.lg },
});
