import type { LucideIcon } from "lucide-react-native";
import { ChevronRight } from "lucide-react-native";
import { type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/theme-provider";
import { radius, space } from "@/theme/tokens";
import { PressableScale } from "./pressable-scale";
import { Text } from "./text";

export interface ListRowProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  iconColor?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  destructive?: boolean;
  accessibilityLabel?: string;
}

export function ListRow({ title, subtitle, icon: Icon, iconColor, leading, trailing, onPress, chevron = Boolean(onPress), destructive, accessibilityLabel }: ListRowProps) {
  const { colors } = useTheme();
  const tint = destructive ? colors.destructive : (iconColor ?? colors.primary);
  const content = (
    <>
      {leading ??
        (Icon ? (
          <View style={[styles.icon, { backgroundColor: destructive ? colors.destructiveSoft : `${tint}1f` }]}>
            <Icon size={18} color={tint} strokeWidth={2.2} />
          </View>
        ) : null)}
      <View style={styles.text}>
        <Text variant="bodyStrong" tone={destructive ? "destructive" : "default"} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" tone="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      {chevron ? <ChevronRight size={18} color={colors.mutedForeground} /> : null}
    </>
  );
  if (!onPress) {
    return (
      <View style={styles.row} accessible accessibilityLabel={accessibilityLabel}>
        {content}
      </View>
    );
  }
  return (
    <PressableScale onPress={onPress} scaleTo={0.98} accessibilityLabel={accessibilityLabel ?? title} style={styles.row}>
      {content}
    </PressableScale>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: inset }} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56, paddingVertical: space.sm },
  icon: { width: 34, height: 34, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, gap: 2 },
});
