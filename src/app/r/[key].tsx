// /r/KEY — someone's personal room link (no code needed).
import { router, useLocalSearchParams } from "expo-router";
import { DoorOpen, Link2 } from "lucide-react-native";
import { useState } from "react";
import Animated, { FadeInDown } from "react-native-reanimated";
import { userMessage } from "@/lib/api/errors";
import { isValidKey } from "@/lib/pairing/pairing";
import { enterSharedRoom } from "@/lib/session/actions";
import { useDevice } from "@/hooks/use-device";
import { space } from "@/theme/tokens";
import { DeviceNameField } from "@/components/room/device-name-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { Banner, EmptyState } from "@/components/ui/states";

export default function RoomLinkScreen() {
  const { key = "" } = useLocalSearchParams<{ key: string }>();
  const identity = useDevice();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = isValidKey(key);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const roomId = await enterSharedRoom(key, "room-link", identity.info());
      router.replace({ pathname: "/room/[roomId]", params: { roomId } });
    } catch (err) {
      setError(userMessage(err));
      setBusy(false);
    }
  };

  return (
    <Screen title="Join this room" subtitle="Someone shared their personal Droply room with you." back>
      {!valid ? (
        <EmptyState icon={Link2} title="This room link isn't valid." body="Ask for a new one." />
      ) : (
        <Animated.View entering={FadeInDown.springify().damping(18)}>
          <Card style={{ gap: space.lg }}>
            <DeviceNameField identity={identity} />
            {error ? <Banner tone="error">{error}</Banner> : null}
            <Button label={busy ? "Joining…" : "Join room"} icon={DoorOpen} size="lg" onPress={() => void submit()} disabled={busy || !identity.name.trim()} loading={busy} fullWidth />
          </Card>
        </Animated.View>
      )}
    </Screen>
  );
}
