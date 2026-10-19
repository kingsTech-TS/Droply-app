import type { LucideIcon } from "lucide-react-native";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/theme/theme-provider";
import { radius, TOUCH } from "@/theme/tokens";
import { PressableScale } from "./pressable-scale";
import { Text } from "./text";

export interface IconButtonProps {
  icon: LucideIcon;
  label: string;
  onPress?: () => void;
  variant?: "plain" | "filled" | "tinted";
  size?: number;
  color?: string;
  badge?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** An icon-only button with a 48pt touch target and a spoken label. */
export function IconButton({ icon: Icon, label, onPress, variant = "plain", size = 22, color, badge, disabled, style }: IconButtonProps) {
  const { colors } = useTheme();
  const bg = variant === "filled" ? colors.secondary : variant === "tinted" ? colors.primarySoft : "transparent";
  const fg = color ?? (variant === "tinted" ? colors.primary : colors.foreground);
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={badge ? `${label}, ${badge} new` : label}
      hitSlop={4}
      scaleTo={0.9}
      style={[{ width: TOUCH, height: TOUCH, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: bg }, style]}
    >
      <Icon size={size} color={fg} strokeWidth={2.1} />
      {badge ? (
        <View
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            paddingHorizontal: 4,
            backgroundColor: colors.destructive,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text variant="caption" color={colors.destructiveForeground} style={{ fontSize: 11, lineHeight: 14, fontWeight: "700" }}>
            {badge > 99 ? "99+" : badge}
          </Text>
        </View>
      ) : null}
    </PressableScale>
  );
}
