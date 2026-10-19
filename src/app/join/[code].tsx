// /join/CODE — what a Droply QR code or join link opens (also typed codes from Home).
import { router, useLocalSearchParams } from "expo-router";
import { DoorOpen } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { isApiError, userMessage } from "@/lib/api/errors";
import { joinByCode } from "@/lib/session/actions";
import { formatRoomCode } from "@/lib/utils/format";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/utils/room-code";
import { useDevice } from "@/hooks/use-device";
import { space } from "@/theme/tokens";
import { DeviceNameField } from "@/components/room/device-name-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CodeInput } from "@/components/ui/code-input";
import { Screen } from "@/components/ui/screen";
import { Banner } from "@/components/ui/states";
import { Text } from "@/components/ui/text";

export default function JoinScreen() {
  const params = useLocalSearchParams<{ code: string }>();
  const identity = useDevice();
  const [code, setCode] = useState(() => normalizeRoomCode(params.code ?? ""));
  const [error, setError] = useState<{ message: string; fatal: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const validCode = isValidRoomCode(code);

  const submit = async () => {
    if (!validCode || busy) return;
    setBusy(true);
    setError(null);
    try {
      const roomId = await joinByCode(code, identity.info());
      router.replace({ pathname: "/room/[roomId]", params: { roomId } });
    } catch (err) {
      const fatal = isApiError(err) && (err.code === "ROOM_EXPIRED" || err.code === "INVALID_ROOM_CODE" || err.code === "ROOM_NOT_FOUND");
      setError({ message: userMessage(err), fatal });
      setBusy(false);
    }
  };

  return (
    <Screen title="Join room" subtitle={validCode ? `Room ${formatRoomCode(code)}` : "Enter the code shown on the other device."} back>
      <Animated.View entering={FadeInDown.springify().damping(18)} style={{ gap: space.lg }}>
        <Card style={{ gap: space.lg }}>
          <View style={{ gap: space.sm }}>
            <Text variant="footnote" tone="muted" style={{ fontWeight: "600" }}>
              Room
            </Text>
            <CodeInput value={code} onChange={setCode} error={code.length === 6 && !validCode} autoFocus={!validCode} />
            {!validCode && code.length > 0 ? (
              <Text variant="footnote" tone="destructive">
                Room codes have 6 letters and numbers.
              </Text>
            ) : null}
          </View>
          <DeviceNameField identity={identity} />
          {error ? (
            <Banner tone="error" action={error.fatal ? <Button label="Create new room" size="sm" variant="outline" onPress={() => router.replace("/")} /> : undefined}>
              {error.message}
            </Banner>
          ) : null}
          <Button label={busy ? "Joining…" : "Join room"} icon={DoorOpen} size="lg" onPress={() => void submit()} disabled={!validCode || busy || !identity.name.trim()} loading={busy} fullWidth />
        </Card>
      </Animated.View>
    </Screen>
  );
}
