// "How fast can your devices talk?" (website: /speed-test): opens a room in speed-test mode;
// the test starts as soon as another device joins.
import { router } from "expo-router";
import { Gauge } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { brand } from "@/config/brand";
import { userMessage } from "@/lib/api/errors";
import { startRoom } from "@/lib/session/actions";
import { useDevice } from "@/hooks/use-device";
import { space } from "@/theme/tokens";
import { SpeedGauge } from "@/components/motion/speed-graphics";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";
import { toast } from "@/components/ui/toast";

export default function SpeedTestScreen() {
  const { info } = useDevice();
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      const roomId = await startRoom(info());
      router.replace({ pathname: "/room/[roomId]", params: { roomId, test: "1" } });
    } catch (error) {
      toast.error(userMessage(error));
      setBusy(false);
    }
  };
  return (
    <Screen title="How fast can your devices talk?" subtitle="Measure the direct connection between two of your devices, over your Wi-Fi or across the internet. Uses test data only: no files, nothing saved." back>
      <Animated.View entering={FadeInDown.springify().damping(18)} style={{ alignItems: "center", gap: space.lg, marginVertical: space.lg }}>
        <SpeedGauge speed={250_000_000} size={220} />
        <Button label={busy ? "Opening…" : "Start a speed test"} icon={Gauge} size="lg" onPress={() => void start()} disabled={busy} loading={busy} />
      </Animated.View>
      <Card style={{ gap: space.lg }}>
        {[
          ["1", "Start the test on this device."],
          ["2", "Scan the QR code with your other device."],
          ["3", "Watch the speedometer and share your result."],
        ].map(([n, text]) => (
          <View key={n} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
            <Text variant="overline" tone="primary">
              0{n}
            </Text>
            <Text style={{ flex: 1 }}>{text}</Text>
          </View>
        ))}
      </Card>
      <Text variant="footnote" tone="muted" center style={{ marginTop: space.lg }}>
        Results depend on both devices, the network between them and whether {brand.name} can connect directly or needs a relay.
      </Text>
    </Screen>
  );
}
