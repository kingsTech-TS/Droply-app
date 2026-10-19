// Development diagnostics (EXPO_PUBLIC_DEBUG=true), same fields as the website's panel.
import { Bug, ChevronDown } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { formatBytes, formatSpeed } from "@/lib/utils/format";
import { usePeerLinks, useRoom, useRoomSession } from "@/hooks/use-room-session";
import { useTheme } from "@/theme/theme-provider";
import { space } from "@/theme/tokens";
import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/text";

interface LiveChannel {
  bufferedAmount: number;
  highWater: number;
  throughput: number | null;
}

export function DiagnosticsPanel() {
  const { colors } = useTheme();
  const session = useRoomSession();
  const room = useRoom();
  const links = usePeerLinks();
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState<Record<string, LiveChannel>>({});
  const lastBytes = useRef(new Map<string, { bytes: number; t: number }>());

  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => {
      const next: Record<string, LiveChannel> = {};
      for (const peerId of Object.keys(session.peers.links.getSnapshot())) {
        const transport = session.peers.get(peerId)?.transport;
        if (!transport) continue;
        const now = performance.now();
        const previous = lastBytes.current.get(peerId);
        const queued = transport.bytesQueued - transport.bufferedAmount;
        const throughput = previous ? ((queued - previous.bytes) * 1000) / (now - previous.t) : null;
        lastBytes.current.set(peerId, { bytes: queued, t: now });
        next[peerId] = { bufferedAmount: transport.bufferedAmount, highWater: transport.currentHighWater, throughput };
      }
      setLive(next);
    }, 1000);
    return () => clearInterval(timer);
  }, [session, open]);

  return (
    <Card style={{ gap: space.sm }}>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.toggle} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Bug size={16} color={colors.mutedForeground} />
        <Text variant="footnote" tone="muted" style={{ fontWeight: "600", flex: 1 }}>
          Diagnostics
        </Text>
        <ChevronDown size={16} color={colors.mutedForeground} />
      </Pressable>
      {open ? (
        <View style={{ gap: space.md }}>
          <Text variant="caption" tone="muted" selectable>
            self {room.selfId} · ws {room.signaling} · attempts {room.reconnectAttempts}
          </Text>
          {Object.values(links).length === 0 ? (
            <Text variant="caption" tone="muted">
              No peer links yet.
            </Text>
          ) : null}
          {Object.values(links).map((link) => {
            const channel = live[link.peerId];
            const rows: Array<[string, string]> = [
              ["Peer ID", link.peerId],
              ["Connection id", link.connectionId ?? "—"],
              ["Link status", link.status],
              ["Connection state", link.connectionState],
              ["ICE connection state", link.iceConnectionState],
              ["ICE candidate type", `${link.localCandidateType ?? "?"} → ${link.remoteCandidateType ?? "?"} (${link.path})`],
              ["DataChannel state", link.channelState],
              ["Buffered amount", channel ? formatBytes(channel.bufferedAmount) : "—"],
              ["High-water mark", channel ? formatBytes(channel.highWater) : "—"],
              ["Frame size", formatBytes(link.frameSize)],
              ["Current throughput", formatSpeed(channel?.throughput ?? null)],
              ["RTT", link.rttMs !== null ? `${link.rttMs} ms` : "—"],
              ["Packets lost", "n/a (not exposed for data channels)"],
              ["Recovery attempts", String(link.attempts)],
            ];
            return (
              <View key={link.peerId} style={{ gap: 2 }}>
                {rows.map(([label, value]) => (
                  <View key={label} style={styles.row}>
                    <Text variant="caption" tone="muted">
                      {label}
                    </Text>
                    <Text variant="caption" selectable style={{ flexShrink: 1, textAlign: "right" }}>
                      {value}
                    </Text>
                  </View>
                ))}
              </View>
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 40 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
});
