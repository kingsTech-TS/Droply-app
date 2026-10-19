// The website's "Built for speed" and "How it works" sections, as swipeable cards.
import { Lock, MonitorSmartphone, QrCode, Rocket, Send, Smartphone, Zap, type LucideIcon } from "lucide-react-native";
import { ScrollView, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/theme-provider";
import { radius, space } from "@/theme/tokens";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/states";
import { Text } from "@/components/ui/text";

const FEATURES: ReadonlyArray<{ icon: LucideIcon; title: string; body: string }> = [
  { icon: Zap, title: "Direct transfers", body: "Files move directly between compatible devices, over your local network when possible." },
  { icon: Lock, title: "Private", body: "Your files don't need to pass through our servers, and they're encrypted in transit." },
  { icon: MonitorSmartphone, title: "Cross-platform", body: "Phone, tablet, laptop, desktop. The app or any browser." },
  { icon: Rocket, title: "Built for large files", body: "Designed for videos, archives and projects, with pause, resume and verification." },
];

const STEPS: ReadonlyArray<{ icon: LucideIcon; title: string; body: string }> = [
  { icon: Send, title: "Create a room", body: "Pick your files or open an empty room." },
  { icon: QrCode, title: "Connect your device", body: "Scan the QR code or type the room code." },
  { icon: Smartphone, title: "Send files directly", body: "Pick a device, it accepts, the files flow." },
];

export function Features() {
  const { colors } = useTheme();
  return (
    <View>
      <SectionHeader title="Built for speed" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll} decelerationRate="fast" snapToInterval={232}>
        {FEATURES.map(({ icon: Icon, title, body }) => (
          <Card key={title} style={styles.feature}>
            <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
              <Icon size={20} color={colors.primary} strokeWidth={2.2} />
            </View>
            <Text variant="bodyStrong">{title}</Text>
            <Text variant="footnote" tone="muted">
              {body}
            </Text>
          </Card>
        ))}
      </ScrollView>
      <SectionHeader title="How it works" />
      <Card style={{ gap: space.lg }}>
        {STEPS.map(({ icon: Icon, title, body }, index) => (
          <View key={title} style={styles.step}>
            <Text variant="overline" tone="primary" style={{ width: 24 }}>
              {String(index + 1).padStart(2, "0")}
            </Text>
            <View style={[styles.icon, { backgroundColor: colors.accent }]}>
              <Icon size={18} color={colors.accentForeground} strokeWidth={2.2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">{title}</Text>
              <Text variant="footnote" tone="muted">
                {body}
              </Text>
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { gap: space.md, paddingRight: space.lg, paddingVertical: 2 },
  feature: { width: 220, gap: space.sm },
  icon: { width: 38, height: 38, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  step: { flexDirection: "row", alignItems: "center", gap: space.md },
});
