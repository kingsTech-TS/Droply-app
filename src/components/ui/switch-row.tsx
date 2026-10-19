import type { LucideIcon } from "lucide-react-native";
import { Platform, StyleSheet, Switch, View } from "react-native";
import { haptic } from "@/lib/fun/celebrate";
import { useTheme } from "@/theme/theme-provider";
import { radius, space } from "@/theme/tokens";
import { Text } from "./text";

export interface SwitchRowProps {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  icon?: LucideIcon;
  disabled?: boolean;
}

export function SwitchRow({ label, hint, value, onChange, icon: Icon, disabled }: SwitchRowProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.row} accessible accessibilityRole="switch" accessibilityState={{ checked: value, disabled }} accessibilityLabel={label} accessibilityHint={hint}>
      {Icon ? (
        <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
          <Icon size={18} color={colors.primary} strokeWidth={2.2} />
        </View>
      ) : null}
      <View style={styles.text}>
        <Text variant="bodyStrong">{label}</Text>
        {hint ? (
          <Text variant="footnote" tone="muted">
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          haptic.select();
          onChange(next);
        }}
        trackColor={{ false: colors.input, true: colors.primary }}
        thumbColor={Platform.OS === "android" ? (value ? colors.primaryForeground : colors.card) : undefined}
        ios_backgroundColor={colors.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, minHeight: 56 },
  icon: { width: 34, height: 34, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, gap: 2 },
});
