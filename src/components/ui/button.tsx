import type { LucideIcon } from "lucide-react-native";
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/theme/theme-provider";
import { radius, space, TOUCH } from "@/theme/tokens";
import { PressableScale } from "./pressable-scale";
import { Text } from "./text";

export type ButtonVariant = "primary" | "secondary" | "tinted" | "outline" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  icon: Icon,
  iconRight: IconRight,
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
  accessibilityLabel,
  accessibilityHint,
}: ButtonProps) {
  const { colors } = useTheme();
  const palette: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: colors.primary, fg: colors.primaryForeground },
    secondary: { bg: colors.secondary, fg: colors.secondaryForeground },
    tinted: { bg: colors.primarySoft, fg: colors.primary },
    outline: { bg: "transparent", fg: colors.foreground, border: colors.border },
    ghost: { bg: "transparent", fg: colors.primary },
    destructive: { bg: colors.destructive, fg: colors.destructiveForeground },
  };
  const p = palette[variant];
  const height = size === "lg" ? 56 : size === "md" ? TOUCH : 38;
  const iconSize = size === "lg" ? 20 : size === "md" ? 18 : 16;
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      hitSlop={size === "sm" ? 6 : 0}
      style={[
        styles.base,
        {
          minHeight: height,
          paddingHorizontal: size === "sm" ? space.md : space.xl,
          backgroundColor: p.bg,
          borderColor: p.border ?? "transparent",
          borderWidth: p.border ? StyleSheet.hairlineWidth * 2 : 0,
          borderRadius: size === "lg" ? radius.lg : radius.md,
          alignSelf: fullWidth ? "stretch" : "auto",
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <View style={styles.row}>
          {Icon ? <Icon size={iconSize} color={p.fg} strokeWidth={2.2} /> : null}
          <Text variant={size === "sm" ? "footnote" : "bodyStrong"} color={p.fg} style={size === "sm" ? styles.smallLabel : undefined} numberOfLines={1}>
            {label}
          </Text>
          {IconRight ? <IconRight size={iconSize} color={p.fg} strokeWidth={2.2} /> : null}
        </View>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  smallLabel: { fontWeight: "600" },
});
