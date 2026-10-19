import { type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import { useTheme } from "@/theme/theme-provider";
import { elevation, radius, space } from "@/theme/tokens";
import { PressableScale } from "./pressable-scale";

export interface CardProps extends ViewProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  /** Dashed border (e.g. "This device"). */
  dashed?: boolean;
  tone?: "default" | "primary" | "muted";
  level?: 0 | 1 | 2;
}

export function Card({ children, style, padded = true, dashed = false, tone = "default", level = 1, ...props }: CardProps) {
  const { colors } = useTheme();
  const bg = tone === "primary" ? colors.primarySoft : tone === "muted" ? colors.muted : colors.card;
  return (
    <View
      style={[
        styles.card,
        elevation(level, colors),
        {
          backgroundColor: bg,
          borderColor: tone === "primary" ? colors.primarySoft : colors.border,
          borderStyle: dashed ? "dashed" : "solid",
          padding: padded ? space.lg : 0,
        },
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
}

export function PressableCard({
  children,
  onPress,
  style,
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.97}
      accessibilityLabel={accessibilityLabel}
      style={[styles.card, elevation(1, colors), { backgroundColor: colors.card, borderColor: colors.border, padding: space.lg }, style]}
    >
      {children}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth * 2 },
});
