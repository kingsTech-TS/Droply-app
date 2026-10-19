// "Files ready to send" (website: send-panel.tsx + file-list + recipient-selector): the
// picked files (swipe-free remove buttons), "Send to" with Select all / Clear all, "Send
// smaller photos", "Send when my device connects", time estimate and the Send button with
// its disabled reason.
import { Folder, Plus, Send, Timer, X } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOutLeft, LinearTransition, ZoomIn } from "react-native-reanimated";
import { formatBytes, formatDuration } from "@/lib/utils/format";
import { haptic } from "@/lib/fun/celebrate";
import { useTheme } from "@/theme/theme-provider";
import { radius, space } from "@/theme/tokens";
import type { DeviceView } from "@/types/device";
import { DeviceIcon } from "@/components/room/device-avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { SwitchRow } from "@/components/ui/switch-row";
import { Text } from "@/components/ui/text";
import { FileIcon } from "./file-icon";

export interface SelectedFileMeta {
  id: string;
  name: string;
  size: number;
  type: string;
  folder: string | null;
}

export function RecipientSelector({ devices, selected, onChange }: { devices: DeviceView[]; selected: ReadonlySet<string>; onChange: (next: Set<string>) => void }) {
  const { colors } = useTheme();
  if (devices.length === 0) {
    return (
      <Text variant="footnote" tone="muted">
        No other devices are online yet. Share the room code to add one.
      </Text>
    );
  }
  return (
    <View style={{ gap: space.sm }} accessibilityRole="list" accessibilityLabel="Send to">
      <View style={styles.between}>
        <Text variant="overline" tone="muted">
          Send to
        </Text>
        {devices.length > 1 ? (
          <View style={{ flexDirection: "row" }}>
            <Button label="Select all" size="sm" variant="ghost" onPress={() => onChange(new Set(devices.map((d) => d.device_id)))} />
            <Button label="Clear all" size="sm" variant="ghost" onPress={() => onChange(new Set())} />
          </View>
        ) : null}
      </View>
      <View style={styles.chips}>
        {devices.map((device) => {
          const checked = selected.has(device.device_id);
          return (
            <PressableScale
              key={device.device_id}
              hapticFeedback="select"
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              accessibilityLabel={device.device_name}
              onPress={() => {
                const next = new Set(selected);
                if (checked) next.delete(device.device_id);
                else next.add(device.device_id);
                onChange(next);
              }}
              style={[
                styles.chip,
                { borderColor: checked ? colors.primary : colors.border, backgroundColor: checked ? colors.primarySoft : colors.card },
              ]}
            >
              <DeviceIcon type={device.device_type} size={16} color={checked ? colors.primary : colors.mutedForeground} />
              <Text variant="callout" tone={checked ? "primary" : "default"} style={{ fontWeight: checked ? "700" : "500", maxWidth: 180 }} numberOfLines={1}>
                {device.device_name}
              </Text>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

export interface SendPanelProps {
  files: SelectedFileMeta[];
  recipients: DeviceView[];
  selected: ReadonlySet<string>;
  onSelectedChange: (next: Set<string>) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onAddMore: () => void;
  onSend: () => void;
  estimateSeconds?: number | null;
  sendSmaller?: boolean;
  onSendSmallerChange?: (value: boolean) => void;
  autoSend?: boolean;
  onAutoSendChange?: (value: boolean) => void;
  preparing?: boolean;
}

export function SendPanel({
  files,
  recipients,
  selected,
  onSelectedChange,
  onRemove,
  onClear,
  onAddMore,
  onSend,
  estimateSeconds = null,
  sendSmaller = false,
  onSendSmallerChange,
  autoSend = false,
  onAutoSendChange,
  preparing = false,
}: SendPanelProps) {
  const { colors } = useTheme();
  const sendable = files.filter((f) => f.size > 0).length;
  const online = new Set(recipients.map((d) => d.device_id));
  const chosen = [...selected].filter((id) => online.has(id)).length;
  const reason =
    sendable === 0
      ? "Add at least one non-empty file"
      : recipients.length === 0
        ? autoSend
          ? "Will send when your device connects"
          : "Waiting for another device"
        : chosen === 0
          ? "Choose a recipient"
          : null;
  const hasPhotos = files.some((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
  const total = files.reduce((s, f) => s + f.size, 0);

  return (
    <Animated.View entering={ZoomIn.springify().damping(18)} layout={LinearTransition.springify()}>
      <Card style={{ gap: space.lg }}>
        <View style={styles.between}>
          <View>
            <Text variant="subhead">Files ready to send</Text>
            <Text variant="footnote" tone="muted">
              {files.length === 1 ? "1 file" : `${files.length} files`} · {formatBytes(total)}
            </Text>
          </View>
          <Button label="Add" icon={Plus} size="sm" variant="tinted" onPress={onAddMore} />
        </View>
        <View style={{ gap: space.xs }}>
          {files.map((file) => (
            <Animated.View key={file.id} entering={FadeIn} exiting={FadeOutLeft.duration(180)} layout={LinearTransition.springify()} style={styles.file}>
              <FileIcon name={file.name} mimeType={file.type} size={38} />
              <View style={{ flex: 1 }}>
                <Text variant="callout" numberOfLines={1}>
                  {file.name}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                  <Text variant="caption" tone={file.size === 0 ? "warning" : "muted"}>
                    {file.size === 0 ? "Empty file, won't be sent" : formatBytes(file.size)}
                  </Text>
                  {file.folder ? (
                    <>
                      <Folder size={11} color={colors.mutedForeground} />
                      <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                        {file.folder}
                      </Text>
                    </>
                  ) : null}
                </View>
              </View>
              <IconButton
                icon={X}
                label={`Remove ${file.name}`}
                size={18}
                onPress={() => {
                  haptic.select();
                  onRemove(file.id);
                }}
              />
            </Animated.View>
          ))}
        </View>
        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />
        <RecipientSelector devices={recipients} selected={selected} onChange={onSelectedChange} />
        {hasPhotos && onSendSmallerChange ? (
          <SwitchRow label="Send smaller photos" hint="Resizes large photos first. Faster on slow networks." value={sendSmaller} onChange={onSendSmallerChange} />
        ) : null}
        {onAutoSendChange && recipients.length === 0 && sendable > 0 ? (
          <SwitchRow label="Send when my device connects" hint="Keep Droply open. The files go to your paired devices as soon as one joins." value={autoSend} onChange={onAutoSendChange} />
        ) : null}
        {estimateSeconds !== null && reason === null ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <Timer size={14} color={colors.mutedForeground} />
            <Text variant="footnote" tone="muted">
              About {formatDuration(estimateSeconds)} on this connection
            </Text>
          </View>
        ) : null}
        <View style={{ gap: space.sm }}>
          <Button
            label={preparing ? "Preparing…" : sendable === 1 ? "Send file" : `Send ${sendable} files`}
            icon={Send}
            size="lg"
            onPress={onSend}
            disabled={reason !== null || preparing}
            loading={preparing}
            fullWidth
            accessibilityHint={reason ?? undefined}
          />
          {reason ? (
            <Text variant="footnote" tone="muted" center>
              {reason}
            </Text>
          ) : null}
          <Button label="Clear files" variant="ghost" size="sm" onPress={onClear} />
        </View>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1.5 },
  file: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 52 },
});
