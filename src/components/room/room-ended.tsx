import { router } from "expo-router";
import { CircleOff, TimerOff, UserX, type LucideIcon } from "lucide-react-native";
import { View } from "react-native";
import Animated, { ZoomIn } from "react-native-reanimated";
import type { RoomSnapshot } from "@/lib/session/room-session";
import { useTheme } from "@/theme/theme-provider";
import { space } from "@/theme/tokens";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";

const COPY: Record<string, { title: string; body: string; icon: LucideIcon }> = {
  expired: { title: "This room has expired.", body: "Create a new room to continue.", icon: TimerOff },
  room_ended: { title: "This room has ended.", body: "Create a new room to continue.", icon: CircleOff },
  room_not_found: { title: "This room doesn't exist anymore.", body: "Create a new room to continue.", icon: CircleOff },
  removed: { title: "You were removed from this room.", body: "Ask for the room code to join again.", icon: UserX },
  unauthorized: { title: "Your session for this room has ended.", body: "Join again with the room code.", icon: UserX },
  forbidden: { title: "This room can't be opened here.", body: "Check the app's server settings (Settings → Diagnostics).", icon: CircleOff },
  left: { title: "You left the room.", body: "Create a new room or join another one.", icon: CircleOff },
  replaced: { title: "This room is open on another device.", body: "This device was signed out of the room there.", icon: CircleOff },
};

export function RoomEnded({ reason }: { reason: RoomSnapshot["endReason"] }) {
  const { colors } = useTheme();
  const copy = COPY[reason ?? "room_ended"] ?? COPY.room_ended!;
  const Icon = copy.icon;
  return (
    <View accessibilityRole="alert" style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xxl }}>
      <Animated.View entering={ZoomIn.springify().damping(14)} style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }}>
        <Icon size={36} color={colors.mutedForeground} />
      </Animated.View>
      <Text variant="headline" center>
        {copy.title}
      </Text>
      <Text tone="muted" center>
        {copy.body}
      </Text>
      <Button label="Create new room" size="lg" onPress={() => router.replace("/")} style={{ marginTop: space.md }} />
    </View>
  );
}
