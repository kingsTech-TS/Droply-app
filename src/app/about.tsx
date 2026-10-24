// About — same content as the website's /about, adjusted for the app.
import { View } from "react-native";
import { brand } from "@/config/brand";
import { space } from "@/theme/tokens";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { SectionHeader } from "@/components/ui/states";
import { Text } from "@/components/ui/text";

const SAFETY = [
  "WebRTC encrypts every transfer in transit (DTLS).",
  "Nobody can send you files without your approval, unless you choose to auto-accept a device.",
  "Every chunk is checked with SHA-256, so a corrupted file is never reported as complete.",
  "Rooms stay open until the host closes them, or close by themselves once nobody has used them for a while. Received files are saved to your device and never opened automatically.",
];

export default function AboutScreen() {
  return (
    <Screen title={`About ${brand.name}`} subtitle={brand.secondaryTagline} back>
      <SectionHeader title="How your files travel" />
      <Card style={{ gap: space.md }}>
        <Text tone="muted">
          Our server only introduces your devices to each other: it creates the room, tells devices who is there and passes along the small messages they need to connect. The files themselves
          travel over a direct WebRTC connection between the two devices — this app or a browser.
        </Text>
        <Text tone="muted">
          Devices on the same network connect directly. Across networks, they connect over the internet when possible. When neither works (some company or mobile networks block it), the connection
          may go through a relay server. Relayed data stays encrypted, and the app always shows which kind of connection is in use.
        </Text>
      </Card>
      <SectionHeader title="Privacy and safety" />
      <Card style={{ gap: space.md }}>
        {SAFETY.map((line) => (
          <View key={line} style={{ flexDirection: "row", gap: space.sm }}>
            <Text tone="primary">•</Text>
            <Text tone="muted" style={{ flex: 1 }}>
              {line}
            </Text>
          </View>
        ))}
      </Card>
      <SectionHeader title="Large files" />
      <Card>
        <Text tone="muted">
          Files are read in pieces, never all at once, so even very large files work on phones. If the connection drops, the transfer pauses and continues from where it stopped once both devices
          are back. Keep Droply open while a transfer runs: phones pause apps in the background.
        </Text>
      </Card>
    </Screen>
  );
}
