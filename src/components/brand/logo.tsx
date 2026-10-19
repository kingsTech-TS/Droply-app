// The brand mark: lucide "zap" on the primary color, as on the website.
import { Zap } from "lucide-react-native";
import { View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { brand } from "@/config/brand";
import { useTheme } from "@/theme/theme-provider";
import { elevation, space } from "@/theme/tokens";
import { Text } from "@/components/ui/text";

export function LogoMark({ size = 32 }: { size?: number }) {
  const { colors } = useTheme();
  return (
    <View style={[{ width: size, height: size, borderRadius: size * 0.28, overflow: "hidden" }, elevation(1, colors)]} accessible={false}>
      <LinearGradient colors={[colors.primary, colors.electric]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Zap size={size * 0.56} color={colors.primaryForeground} fill={colors.primaryForeground} strokeWidth={1.5} />
      </LinearGradient>
    </View>
  );
}

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }} accessibilityRole="header" accessibilityLabel={brand.name}>
      <LogoMark size={size} />
      <Text variant="headline" style={{ fontSize: size * 0.62, lineHeight: size * 0.8 }}>
        {brand.name}
      </Text>
    </View>
  );
}
