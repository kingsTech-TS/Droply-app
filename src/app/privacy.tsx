// "What our server sees" — same copy as the website's /privacy.
import { Check, X } from "lucide-react-native";
import { View } from "react-native";
import { brand } from "@/config/brand";
import { useTheme } from "@/theme/theme-provider";
import { space } from "@/theme/tokens";
import { Card } from "@/components/ui/card";
import { Screen } from "@/components/ui/screen";
import { SectionHeader } from "@/components/ui/states";
import { Text } from "@/components/ui/text";

const SEES = [
  ["Room code and expiry", "So devices can find each other."],
  ["Device names, types and browsers", "Shown to the other devices in the room."],
  ["File names, sizes and types", "So the other device can approve the transfer. Not stored after the room ends."],
  ["Transfer progress (which chunks arrived)", "So an interrupted transfer can resume."],
  ["Your IP address, as a keyed hash", "For rate limits and, only if a host turns it on, nearby discovery."],
  ["Connection setup messages", "Relayed between devices, never stored."],
] as const;

const NEVER = [
  ["File contents", "They go directly between devices, encrypted (DTLS)."],
  ["Texts and chat messages", "Sent over the same encrypted peer-to-peer connection."],
  ["Your pairing and room-link keys", "Only a keyed hash, which can't be turned back into the key."],
  ["Your history, stats and badges", "Kept on your device only."],
  ["Accounts, emails or phone numbers", "There are none."],
] as const;

function Item({ what, why, ok }: { what: string; why: string; ok: boolean }) {
  const { colors } = useTheme();
  const Icon = ok ? Check : X;
  return (
    <View style={{ flexDirection: "row", gap: space.md }}>
      <Icon size={18} color={ok ? colors.success : colors.destructive} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">{what}</Text>
        <Text variant="footnote" tone="muted">
          {why}
        </Text>
      </View>
    </View>
  );
}

export default function PrivacyScreen() {
  return (
    <Screen title="What our server sees" subtitle={`${brand.name}'s server only introduces your devices to each other. Here is exactly what passes through it, and what never does.`} back>
      <SectionHeader title="The server sees" />
      <Card style={{ gap: space.lg }}>
        {SEES.map(([what, why]) => (
          <Item key={what} what={what} why={why} ok />
        ))}
      </Card>
      <SectionHeader title="The server never sees" />
      <Card style={{ gap: space.lg }}>
        {NEVER.map(([what, why]) => (
          <Item key={what} what={what} why={why} ok={false} />
        ))}
      </Card>
      <SectionHeader title="About relays" />
      <Card>
        <Text tone="muted">
          When two devices can&apos;t connect directly (some company and mobile networks block it), data goes through a relay server (TURN). It stays encrypted end to end, and the room shows
          &quot;Relay connection&quot; so you always know. To check that nobody is in the middle, compare the security code (four emoji) in a device&apos;s menu on both screens.
        </Text>
      </Card>
    </Screen>
  );
}
