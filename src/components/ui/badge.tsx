import type { LucideIcon } from "lucide-react-native";
import { View } from "react-native";
import { useTheme } from "@/theme/theme-provider";
import { radius, space } from "@/theme/tokens";
import { Text } from "./text";

export type BadgeVariant = "default" | "secondary" | "success" | "warning" | "destructive" | "electric";

export function Badge({ label, variant = "secondary", icon: Icon }: { label: string; variant?: BadgeVariant; icon?: LucideIcon }) {
  const { colors } = useTheme();
  const map: Record<BadgeVariant, { bg: string; fg: string }> = {
    default: { bg: colors.primarySoft, fg: colors.primary },
    secondary: { bg: colors.secondary, fg: colors.secondaryForeground },
    success: { bg: colors.successSoft, fg: colors.success },
    warning: { bg: colors.warningSoft, fg: colors.warning },
    destructive: { bg: colors.destructiveSoft, fg: colors.destructive },
    electric: { bg: colors.electricSoft, fg: colors.electric },
  };
  const { bg, fg } = map[variant];
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        alignSelf: "flex-start",
        paddingHorizontal: space.sm + 2,
        paddingVertical: 4,
        borderRadius: radius.pill,
        backgroundColor: bg,
      }}
    >
      {Icon ? <Icon size={13} color={fg} strokeWidth={2.4} /> : null}
      <Text variant="caption" color={fg} style={{ fontWeight: "600" }}>
        {label}
      </Text>
    </View>
  );
}
