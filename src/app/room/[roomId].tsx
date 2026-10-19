// /room/ID — opens (or returns to) the room session and shows the room. Leaving this screen
// doesn't leave the room: the session keeps running so transfers continue, and Home shows a
// "back to your room" card.
import { useLocalSearchParams } from "expo-router";
import { DoorOpen } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";
import type { RoomSession } from "@/lib/session/room-session";
import { openSession } from "@/lib/session/registry";
import { loadSession } from "@/lib/session/session-store";
import { applyRoomTheme } from "@/lib/fun/themes";
import { RoomSessionProvider } from "@/hooks/use-room-session";
import { useTheme } from "@/theme/theme-provider";
import { space } from "@/theme/tokens";
import { JoinCard } from "@/components/home/join-card";
import { RoomView } from "@/components/room/room-view";
import { Screen } from "@/components/ui/screen";
import { EmptyState, Skeleton } from "@/components/ui/states";

type State = { kind: "loading" } | { kind: "no-session" } | { kind: "ready"; session: RoomSession };

export default function RoomScreen() {
  const { roomId = "", test } = useLocalSearchParams<{ roomId: string; test?: string }>();
  const { colors } = useTheme();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    // While the room opens, use the theme saved when this device entered.
    applyRoomTheme(loadSession(roomId)?.theme ?? null);
    // The room session is an external system (WebSocket, peer connections), created here and
    // published to React once (same as the website's room-screen).
    const session = openSession(roomId);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(session ? { kind: "ready", session } : { kind: "no-session" });
  }, [roomId]);

  if (state.kind === "ready") {
    return (
      <RoomSessionProvider session={state.session}>
        <RoomView speedTest={test === "1"} />
      </RoomSessionProvider>
    );
  }
  if (state.kind === "no-session") {
    return (
      <Screen title="You're not in this room" back>
        <EmptyState icon={DoorOpen} title="Enter the room code shown on the other device to join." />
        <JoinCard />
      </Screen>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, padding: space.xl, paddingTop: 120, gap: space.lg }} accessibilityLabel="Opening room…">
      <Skeleton height={28} width="60%" />
      <Skeleton height={140} />
      <Skeleton height={90} />
      <Skeleton height={90} />
    </View>
  );
}
