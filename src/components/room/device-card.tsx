// One device in the room (website: device-card.tsx): avatar, name, "(this device)" / host /
// paired, OS • app/browser, presence as text + dot, connection badge, quality, Send files,
// and a ⋯ menu (as a sheet) with text, speed test, pairing, relay, remove and the security
// code. Registers itself as a flight-path endpoint.
import { Ellipsis, Gauge, Link2, MessageSquareText, RefreshCw, Send, ShieldCheck, UserX } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeInDown, FadeOutUp, LinearTransition } from "react-native-reanimated";
import type { LinkInfo } from "@/lib/webrtc/peer-connection";
import { useTheme } from "@/theme/theme-provider";
import { radius, space } from "@/theme/tokens";
import type { DeviceView } from "@/types/device";
import { deviceAnchor } from "@/components/session-effects";
import { useFlightAnchor } from "@/components/motion/effects-overlay";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { Divider, ListRow } from "@/components/ui/list-row";
import { Sheet } from "@/components/ui/sheet";
import { Text } from "@/components/ui/text";
import { ConnectionBadge, QualityIndicator } from "./connection-badge";
import { DeviceAvatar } from "./device-avatar";

export interface DeviceCardActions {
  onSend?: () => void;
  onSendText?: () => void;
  onSpeedTest?: () => void;
  onPair?: () => void;
  onRetry?: (relayOnly: boolean) => void;
  onRemove?: () => void;
}

export interface DeviceCardProps extends DeviceCardActions {
  device: DeviceView;
  isSelf?: boolean;
  link?: LinkInfo;
  paired?: boolean;
}

export function DeviceCard({ device, isSelf = false, link, paired = false, onSend, onSendText, onSpeedTest, onPair, onRetry, onRemove }: DeviceCardProps) {
  const { colors } = useTheme();
  const [menu, setMenu] = useState(false);
  const anchor = useFlightAnchor(isSelf ? null : deviceAnchor(device.device_id));
  const PRESENCE: Record<DeviceView["connection_state"], { label: string; dot: string }> = {
    connected: { label: "Online", dot: colors.success },
    connecting: { label: "Joining…", dot: colors.warning },
    reconnecting: { label: "Reconnecting…", dot: colors.warning },
    disconnected: { label: "Offline", dot: colors.mutedForeground },
  };
  const presence = PRESENCE[device.connection_state];
  const details = [device.operating_system, device.browser].filter(Boolean).join(" • ");
  const online = device.connection_state === "connected";
  const hasMenu = !isSelf && Boolean(onSendText || onSpeedTest || onPair || onRetry || onRemove || link?.securityCode);
  const act = (fn?: () => void) => () => {
    setMenu(false);
    fn?.();
  };

  return (
    <Animated.View ref={anchor} collapsable={false} entering={FadeInDown.springify().damping(17)} exiting={FadeOutUp.duration(200)} layout={LinearTransition.springify().damping(20)}>
      <Card dashed={isSelf} tone={isSelf ? "muted" : "default"} level={isSelf ? 0 : 1} style={{ gap: space.md }} accessibilityLabel={`${device.device_name}${isSelf ? " (this device)" : ""}, ${presence.label}`}>
        <View style={styles.top}>
          <DeviceAvatar name={device.device_name} type={device.device_type} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {device.device_name}
            </Text>
            <Text variant="footnote" tone="muted" numberOfLines={1}>
              {[isSelf ? "This device" : null, device.is_host ? "Host" : null, paired ? "Paired" : null, details || null].filter(Boolean).join(" · ")}
            </Text>
          </View>
          {hasMenu ? <IconButton icon={Ellipsis} label={`More options for ${device.device_name}`} onPress={() => setMenu(true)} /> : null}
        </View>
        <View style={styles.status}>
          <View style={styles.presence}>
            <View style={[styles.dot, { backgroundColor: presence.dot }]} />
            <Text variant="caption" tone="muted">
              {presence.label}
            </Text>
          </View>
          {!isSelf ? <ConnectionBadge link={link} /> : null}
          {!isSelf ? <QualityIndicator link={link} /> : null}
        </View>
        {!isSelf && link?.status === "failed" && onRetry ? (
          <View style={styles.row}>
            <Button label="Retry connection" size="sm" variant="outline" onPress={() => onRetry(false)} />
            <Button label="Try relay" size="sm" variant="ghost" onPress={() => onRetry(true)} />
          </View>
        ) : null}
        {!isSelf && onSend ? <Button label="Send files" icon={Send} size="sm" variant="tinted" onPress={onSend} disabled={!online} fullWidth /> : null}
      </Card>
      {hasMenu ? (
        <Sheet visible={menu} onClose={() => setMenu(false)} title={device.device_name} subtitle={details || undefined}>
          {onSendText ? <ListRow icon={MessageSquareText} title="Send text or link" onPress={online ? act(onSendText) : undefined} subtitle={online ? undefined : "Device is offline"} /> : null}
          {onSpeedTest ? (
            <>
              <Divider inset={46} />
              <ListRow icon={Gauge} title="Test speed" onPress={online ? act(onSpeedTest) : undefined} />
            </>
          ) : null}
          {onPair && !paired ? (
            <>
              <Divider inset={46} />
              <ListRow icon={Link2} title="Add to My devices" subtitle="Only pair your own devices" onPress={online ? act(onPair) : undefined} />
            </>
          ) : null}
          {onRetry ? (
            <>
              <Divider inset={46} />
              <ListRow icon={RefreshCw} title="Reconnect through relay" subtitle="If a direct connection keeps failing" onPress={online ? act(() => onRetry(true)) : undefined} />
            </>
          ) : null}
          {onRemove ? (
            <>
              <Divider inset={46} />
              <ListRow icon={UserX} title="Remove from room" destructive onPress={act(onRemove)} />
            </>
          ) : null}
          {link?.securityCode ? (
            <View style={[styles.code, { backgroundColor: colors.successSoft }]}>
              <View style={styles.row}>
                <ShieldCheck size={18} color={colors.success} />
                <Text variant="bodyStrong" tone="success">
                  Security code
                </Text>
              </View>
              <Text style={{ fontSize: 34, lineHeight: 44, letterSpacing: 6 }} accessibilityLabel={`Security code ${link.securityCode}`}>
                {link.securityCode}
              </Text>
              <Text variant="footnote" tone="muted">
                Same emoji on both screens means nobody is in the middle.
              </Text>
            </View>
          ) : null}
        </Sheet>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: space.md },
  status: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.sm },
  presence: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  code: { gap: space.sm, padding: space.lg, borderRadius: radius.lg, alignItems: "center" },
});
