// One transfer (website: transfer-card.tsx + transfer-progress + transfer-details): status,
// verified progress, speed / ETA / path, a speedometer for big files, per-recipient legs or a
// delivery roster, reactions, details, and Pause / Resume / Retry / Cancel / Save / Send again.
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  FileSearch,
  Folder,
  Globe,
  Pause,
  Play,
  RefreshCw,
  Repeat,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  X,
  Zap,
} from "lucide-react-native";
import { memo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut, FadeOutLeft, LinearTransition, useAnimatedStyle, withTiming } from "react-native-reanimated";
import { haptic } from "@/lib/fun/celebrate";
import type { LocalFile } from "@/lib/files/local-file";
import { formatBytes, formatDuration, formatPercent, formatSpeed } from "@/lib/utils/format";
import type { LinkInfo } from "@/lib/webrtc/peer-connection";
import { REACTIONS, type Reaction } from "@/lib/webrtc/protocol";
import type { TransferSnapshot } from "@/lib/webrtc/transfer-manager";
import { isTerminal, statusLabel } from "@/lib/webrtc/transfer-state";
import { aggregateProgress, failureMessage, primaryStatus, type AggregateProgress } from "@/lib/webrtc/transfer-view";
import { useTheme } from "@/theme/theme-provider";
import { radius, space } from "@/theme/tokens";
import { CheckDraw } from "@/components/motion/check-draw";
import { Sparkline, SpeedGauge } from "@/components/motion/speed-graphics";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { confirm } from "@/components/ui/confirm";
import { IconButton } from "@/components/ui/icon-button";
import { ProgressBar, type ProgressTone } from "@/components/ui/progress-bar";
import { Text } from "@/components/ui/text";
import { FileIcon } from "./file-icon";
import { MediaThumb } from "./media-thumb";

export interface TransferCardActions {
  pause: () => void;
  resume: () => void;
  cancel: () => void;
  retry: () => void;
  save: () => void;
  dismiss: () => void;
  reselect: () => void;
  react?: (emoji: Reaction) => void;
  sendAgain?: () => void;
  openMedia?: () => void;
}

const CONFIRM_CANCEL_BYTES = 100_000_000;
const LARGE_FILE_BYTES = 100_000_000;
const ROSTER_THRESHOLD = 6;

const PATH: Record<LinkInfo["path"], { label: string; icon: typeof Zap } | null> = {
  lan: { label: "Direct", icon: Zap },
  direct: { label: "Internet", icon: Globe },
  relay: { label: "Relay", icon: RefreshCw },
  unknown: null,
};

const PATH_LABEL: Record<LinkInfo["path"], string> = {
  lan: "Direct P2P (local network)",
  direct: "Direct P2P (internet)",
  relay: "Relayed (TURN)",
  unknown: "Not established yet",
};

function Rates({ progress, link, large }: { progress: AggregateProgress; link?: LinkInfo; large: boolean }) {
  const { colors } = useTheme();
  const path = link && link.status === "connected" ? PATH[link.path] : null;
  const PathIcon = path?.icon;
  return (
    <View style={styles.rates}>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.inline}>
          <Zap size={16} color={colors.primary} fill={colors.primary} />
          <Text variant="headline" style={{ fontVariant: ["tabular-nums"] }} accessibilityLiveRegion="none">
            {formatSpeed(progress.speed)}
          </Text>
        </View>
        <View style={styles.inline}>
          {path && PathIcon ? (
            <View style={styles.inline}>
              <PathIcon size={12} color={colors.mutedForeground} />
              <Text variant="caption" tone="muted">
                {path.label}
              </Text>
            </View>
          ) : null}
          {progress.etaSeconds !== null ? (
            <Text variant="caption" tone="muted">
              ~{formatDuration(progress.etaSeconds)} left
            </Text>
          ) : null}
        </View>
      </View>
      {large ? <SpeedGauge speed={progress.speed} size={84} /> : null}
      <Sparkline values={progress.speedHistory} width={90} />
    </View>
  );
}

function Details({ progress, link }: { progress: AggregateProgress; link: LinkInfo | undefined }) {
  const rows: Array<[string, string]> = [
    ["Connection", link && link.status === "connected" ? PATH_LABEL[link.path] : "Not connected"],
    ["Current speed", formatSpeed(progress.speed)],
    ["Average speed", formatSpeed(progress.averageSpeed)],
    ["Latency", link?.rttMs != null ? `${link.rttMs} ms` : "—"],
    ["Data transferred", formatBytes(progress.verifiedBytes)],
    ["Estimated remaining", progress.etaSeconds !== null ? formatDuration(progress.etaSeconds) : "—"],
  ];
  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)} style={{ gap: space.xs }}>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.detailRow}>
          <Text variant="footnote" tone="muted">
            {label}
          </Text>
          <Text variant="footnote" style={{ fontWeight: "600" }}>
            {value}
          </Text>
        </View>
      ))}
    </Animated.View>
  );
}

export interface TransferCardProps {
  item: TransferSnapshot;
  deviceName: (id: string) => string;
  link: LinkInfo | undefined;
  actions: TransferCardActions;
  media?: LocalFile | null;
}

function TransferCardInner({ item, deviceName, link, actions, media }: TransferCardProps) {
  const { colors } = useTheme();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const status = primaryStatus(item);
  const progress = aggregateProgress(item);
  const outgoing = item.direction === "outgoing";
  const firstLeg = item.legs[0];
  const autoResume = item.legs.some((l) => l.autoResume && l.status === "paused");
  const done = item.legs.every((l) => isTerminal(l.status));
  const completed = item.legs.some((l) => l.status === "completed");
  const failed = status === "failed";
  const verifyFailed = item.verification === "failed";
  const delivered = item.legs.filter((l) => l.status === "completed").length;
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: withTiming(detailsOpen ? "180deg" : "0deg", { duration: 200 }) }] }));

  const peerText = outgoing
    ? item.peerIds.length > 3
      ? `To ${item.peerIds.length} devices`
      : `To ${item.peerIds.map(deviceName).join(", ")}`
    : `From ${item.peerIds.map(deviceName).join(", ")}`;

  const requestCancel = async () => {
    const large = item.fileSize > CONFIRM_CANCEL_BYTES;
    if (large && (status === "transferring" || status === "paused")) {
      const ok = await confirm({
        title: "Cancel this transfer?",
        message: `${item.fileName} will stop, and the transfer can no longer be resumed.`,
        confirmLabel: "Cancel transfer",
        cancelLabel: "Keep transfer",
        destructive: true,
      });
      if (ok) actions.cancel();
    } else {
      actions.cancel();
    }
  };

  let statusText: string = statusLabel(status);
  if (status === "paused" && autoResume) statusText = "Connection interrupted. Waiting to reconnect…";
  if (status === "failed" && firstLeg) statusText = failureMessage(firstLeg);
  if (!outgoing && item.save === "preparing") statusText = "Verifying…";
  if (status === "transferring") statusText = outgoing ? "Sending" : "Receiving";
  if (item.needsReselect) statusText = "Select the file again to resume";

  const tone: ProgressTone = completed ? "success" : failed || verifyFailed ? "error" : status === "paused" ? "paused" : "default";
  const showPreview = media && (outgoing || item.save === "ready" || item.save === "saved");
  const percent = Math.floor(progress.fraction * 100);

  return (
    <Animated.View entering={FadeInDown.springify().damping(18)} exiting={FadeOutLeft.duration(200)} layout={LinearTransition.springify().damping(20)}>
      <Card style={{ gap: space.md }} accessibilityLabel={`${item.fileName}, ${completed ? "complete" : statusText}`}>
        <View style={styles.header}>
          {showPreview && media ? <MediaThumb file={media} name={item.fileName} onOpen={actions.openMedia} /> : <FileIcon name={item.fileName} mimeType={item.mimeType} />}
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {item.fileName}
            </Text>
            <View style={styles.inline}>
              {outgoing ? <ArrowUp size={12} color={colors.mutedForeground} /> : <ArrowDown size={12} color={colors.mutedForeground} />}
              <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                {peerText} · {formatBytes(item.fileSize)}
              </Text>
              {item.relativePath ? (
                <>
                  <Folder size={11} color={colors.mutedForeground} />
                  <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {item.relativePath}
                  </Text>
                </>
              ) : null}
            </View>
          </View>
          {done || failed ? <IconButton icon={X} label={`Dismiss ${item.fileName}`} size={18} onPress={actions.dismiss} /> : null}
        </View>

        <View style={styles.inline}>
          {completed ? <CheckDraw size={22} /> : null}
          <Text variant="footnote" tone={completed ? "success" : failed || verifyFailed ? "destructive" : "muted"} style={{ fontWeight: "600", flexShrink: 1 }} accessibilityLiveRegion="polite">
            {completed ? (outgoing && item.legs.length > 1 ? `Delivered to ${delivered} of ${item.legs.length}` : "Transfer complete") : statusText}
          </Text>
        </View>
        {!outgoing && item.verification === "verified" ? (
          <View style={styles.inline}>
            <ShieldCheck size={14} color={colors.success} />
            <Text variant="caption" tone="success">
              File verified
            </Text>
          </View>
        ) : null}
        {verifyFailed ? (
          <View style={styles.inline}>
            <ShieldAlert size={14} color={colors.destructive} />
            <Text variant="caption" tone="destructive">
              File verification failed
            </Text>
          </View>
        ) : null}

        {!(completed && done) ? (
          <View style={{ gap: space.sm }}>
            {status === "transferring" ? <Rates progress={progress} link={link} large={item.fileSize >= LARGE_FILE_BYTES} /> : null}
            <View style={styles.between}>
              <Text variant="caption" style={{ fontWeight: "700", fontVariant: ["tabular-nums"] }}>
                {formatPercent(progress.fraction)}
              </Text>
              <Text variant="caption" tone="muted" style={{ fontVariant: ["tabular-nums"] }}>
                {formatBytes(progress.verifiedBytes)} / {formatBytes(progress.totalBytes)}
              </Text>
            </View>
            <ProgressBar
              value={progress.fraction}
              tone={tone}
              active={status === "transferring"}
              accessibilityLabel={`${item.fileName} progress`}
              accessibilityValueText={`${percent}%, ${formatBytes(progress.verifiedBytes)} of ${formatBytes(progress.totalBytes)}`}
            />
          </View>
        ) : (
          <Text variant="footnote" tone="muted">
            {[
              `${formatBytes(item.fileSize)}${progress.activeSeconds >= 1 ? ` in ${formatDuration(progress.activeSeconds)}` : ""}`,
              progress.averageSpeed ? `average ${formatSpeed(progress.averageSpeed)}` : null,
              progress.peakSpeed ? `top ${formatSpeed(progress.peakSpeed)}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        )}

        {outgoing && item.legs.length > 1 ? (
          item.legs.length >= ROSTER_THRESHOLD ? (
            <View style={styles.roster} accessibilityLabel="Delivery status per device">
              {item.legs.map((leg) => {
                const ok = leg.status === "completed";
                const moving = leg.status === "transferring";
                const bad = leg.status === "rejected" || leg.status === "failed" || leg.status === "cancelled";
                return (
                  <View
                    key={leg.deviceId}
                    style={[styles.rosterChip, { backgroundColor: ok ? colors.successSoft : moving ? colors.electricSoft : bad ? colors.destructiveSoft : colors.muted }]}
                  >
                    <Text variant="caption" color={ok ? colors.success : moving ? colors.electric : bad ? colors.destructive : colors.mutedForeground} numberOfLines={1} style={{ maxWidth: 120 }}>
                      {deviceName(leg.deviceId)}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={{ gap: space.xs }}>
              {item.legs.map((leg) => (
                <View key={leg.deviceId} style={styles.between}>
                  <Text variant="footnote" numberOfLines={1} style={{ flex: 1 }}>
                    {deviceName(leg.deviceId)}
                  </Text>
                  <Text variant="footnote" tone="muted">
                    {leg.status === "transferring" ? `${Math.floor((leg.verifiedBytes / Math.max(1, item.fileSize)) * 100)}% · ${formatSpeed(leg.speed)}` : statusLabel(leg.status)}
                  </Text>
                </View>
              ))}
            </View>
          )
        ) : null}

        {outgoing && item.reactions.length > 0 ? (
          <Text style={{ fontSize: 22 }} accessibilityLabel={`Reactions: ${item.reactions.join(" ")}`}>
            {item.reactions.join(" ")}
          </Text>
        ) : null}

        <View style={styles.actions}>
          {item.needsReselect ? <Button label="Select file" icon={FileSearch} size="sm" onPress={actions.reselect} /> : null}
          {status === "transferring" ? <Button label="Pause" icon={Pause} size="sm" variant="secondary" onPress={actions.pause} /> : null}
          {status === "paused" && !autoResume && !item.needsReselect ? <Button label="Resume" icon={Play} size="sm" onPress={actions.resume} /> : null}
          {failed && !item.needsReselect ? <Button label={firstLeg?.failureReason === "no_route" ? "Try again" : "Resume"} icon={RotateCcw} size="sm" onPress={actions.retry} /> : null}
          {!outgoing && (item.save === "ready" || item.save === "saving") ? <Button label={item.save === "saving" ? "Saving…" : "Open / Save"} size="sm" onPress={actions.save} disabled={item.save === "saving"} /> : null}
          {!outgoing && item.save === "saved" ? (
            <View style={styles.inline}>
              <ShieldCheck size={14} color={colors.success} />
              <Text variant="footnote" tone="success" style={{ fontWeight: "600" }}>
                Saved
              </Text>
            </View>
          ) : null}
          {outgoing && done && item.canResend && actions.sendAgain ? <Button label="Send again" icon={Repeat} size="sm" variant="outline" onPress={actions.sendAgain} /> : null}
          {!done ? <Button label="Cancel" size="sm" variant="ghost" onPress={() => void requestCancel()} /> : null}
        </View>

        {!outgoing && completed && actions.react ? (
          <View style={styles.reactions} accessibilityRole="radiogroup" accessibilityLabel="React to this file">
            {REACTIONS.map((emoji) => {
              const chosen = item.reactions.includes(emoji);
              return (
                <Pressable
                  key={emoji}
                  onPress={() => {
                    haptic.select();
                    actions.react?.(emoji);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: chosen }}
                  accessibilityLabel={`React ${emoji}`}
                  style={[styles.reaction, chosen ? { backgroundColor: colors.primarySoft, borderColor: colors.primary } : { borderColor: "transparent" }]}
                >
                  <Text style={{ fontSize: 20 }}>{emoji}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {status === "transferring" || status === "paused" ? (
          <View>
            <Pressable onPress={() => setDetailsOpen((v) => !v)} style={styles.detailsToggle} accessibilityRole="button" accessibilityState={{ expanded: detailsOpen }}>
              <Text variant="footnote" tone="muted" style={{ fontWeight: "600" }}>
                Transfer details
              </Text>
              <Animated.View style={chevron}>
                <ChevronDown size={16} color={colors.mutedForeground} />
              </Animated.View>
            </Pressable>
            {detailsOpen ? <Details progress={progress} link={link} /> : null}
          </View>
        ) : null}
      </Card>
    </Animated.View>
  );
}

export const TransferCard = memo(TransferCardInner);

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: space.md },
  inline: { flexDirection: "row", alignItems: "center", gap: space.xs },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  rates: { flexDirection: "row", alignItems: "center", gap: space.md },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm },
  roster: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  rosterChip: { paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill },
  reactions: { flexDirection: "row", gap: space.xs, flexWrap: "wrap" },
  reaction: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 1.5 },
  detailsToggle: { flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: 40 },
  detailRow: { flexDirection: "row", justifyContent: "space-between" },
});
