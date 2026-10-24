// Full-screen QR code for scanning from across a room (events, classes). Brightness is
// raised while it's shown and restored afterwards.
import { router } from "expo-router";
import * as Brightness from "expo-brightness";
import { X } from "lucide-react-native";
import { useEffect, useSyncExternalStore } from "react";
import { useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { activeSession } from "@/lib/session/registry";
import { formatRoomCode } from "@/lib/utils/format";
import { joinUrlFor } from "@/lib/utils/join-url";
import { useTheme } from "@/theme/theme-provider";
import { space, type } from "@/theme/tokens";
import { QrCode } from "@/components/room/qr-code";
import { IconButton } from "@/components/ui/icon-button";
import { Text } from "@/components/ui/text";

export default function PresentScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const session = useSyncExternalStore(activeSession.subscribe, activeSession.getSnapshot, activeSession.getSnapshot);
  const room = useSyncExternalStore(session?.room.subscribe ?? (() => () => undefined), session?.room.getSnapshot ?? (() => null), session?.room.getSnapshot ?? (() => null));

  useEffect(() => {
    let previous: number | null = null;
    void (async () => {
      try {
        previous = await Brightness.getBrightnessAsync();
        await Brightness.setBrightnessAsync(1);
      } catch {
        // Not allowed on this device: the QR is still readable.
      }
    })();
    return () => {
      if (previous !== null) void Brightness.setBrightnessAsync(previous).catch(() => undefined);
    };
  }, []);

  if (!room) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <Text tone="muted">No room is open.</Text>
      </View>
    );
  }
  const joinUrl = joinUrlFor(room.roomCode, room.joinUrl);
  const size = Math.floor(Math.min(480, Math.min(width, height) * 0.62));
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", gap: space.xl, padding: space.xl }}>
      <Text variant="title" center>
        Scan to join
      </Text>
      <QrCode value={joinUrl} size={size} />
      <Text style={[type.code, { color: colors.foreground, fontSize: 52, lineHeight: 60 }]} accessibilityLabel={`Room code ${room.roomCode.split("").join(" ")}`}>
        {formatRoomCode(room.roomCode)}
      </Text>
      <Text tone="muted" center>
        {room.devices.length === 1 ? "1 device joined" : `${room.devices.length} devices joined`} · or open {joinUrl.replace(/^https?:\/\//, "").replace(/\/join\/.*/, "")}
      </Text>
      <View style={{ position: "absolute", top: insets.top + space.sm, right: space.lg }}>
        <IconButton icon={X} label="Close" variant="filled" onPress={() => router.back()} />
      </View>
    </View>
  );
}
