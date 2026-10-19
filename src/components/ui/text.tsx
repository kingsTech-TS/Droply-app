import { Text as RNText, type TextProps as RNTextProps } from "react-native";
import { useTheme } from "@/theme/theme-provider";
import { type, type TypeVariant } from "@/theme/tokens";

export type TextTone = "default" | "muted" | "primary" | "electric" | "success" | "warning" | "destructive" | "inverse" | "onPrimary";

export interface TextProps extends RNTextProps {
  variant?: TypeVariant;
  tone?: TextTone;
  /** Overrides the tone with an explicit color. */
  color?: string;
  center?: boolean;
}

export function Text({ variant = "body", tone = "default", color, center, style, maxFontSizeMultiplier = 1.6, ...props }: TextProps) {
  const { colors } = useTheme();
  const toneColor: Record<TextTone, string> = {
    default: colors.foreground,
    muted: colors.mutedForeground,
    primary: colors.primary,
    electric: colors.electric,
    success: colors.success,
    warning: colors.warning,
    destructive: colors.destructive,
    inverse: colors.background,
    onPrimary: colors.primaryForeground,
  };
  return (
    <RNText
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[type[variant], { color: color ?? toneColor[tone] }, center ? { textAlign: "center" } : null, style]}
      {...props}
    />
  );
}
