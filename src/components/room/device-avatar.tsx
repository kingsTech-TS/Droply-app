import { Laptop, Monitor, Smartphone, Tablet, type LucideIcon } from "lucide-react-native";
import { View } from "react-native";
import { splitAvatar } from "@/lib/fun/names";
import { useTheme } from "@/theme/theme-provider";
import { radius } from "@/theme/tokens";
import type { DeviceType } from "@/types/device";
import { Text } from "@/components/ui/text";

const ICONS: Record<DeviceType, LucideIcon> = {
  phone: Smartphone,
  tablet: Tablet,
  laptop: Laptop,
  desktop: Monitor,
  unknown: Monitor,
};

export const DEVICE_LABEL: Record<DeviceType, string> = {
  phone: "Phone",
  tablet: "Tablet",
  laptop: "Laptop",
  desktop: "Desktop",
  unknown: "Device",
};

export function DeviceIcon({ type, size = 20, color }: { type: DeviceType; size?: number; color?: string }) {
  const { colors } = useTheme();
  const Icon = ICONS[type];
  return <Icon size={size} color={color ?? colors.accentForeground} strokeWidth={2} />;
}

/** The device's emoji avatar (from a fun name like "🦦 Sneaky Otter"), or its type icon. */
export function DeviceAvatar({ name, type, size = 44 }: { name: string; type: DeviceType; size?: number }) {
  const { colors } = useTheme();
  const { avatar } = splitAvatar(name);
  const badge = Math.round(size * 0.46);
  return (
    <View
      accessible
      accessibilityLabel={DEVICE_LABEL[type]}
      style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" }}
    >
      {avatar ? <Text style={{ fontSize: size * 0.5, lineHeight: size * 0.62 }}>{avatar}</Text> : <DeviceIcon type={type} size={size * 0.48} />}
      {avatar ? (
        <View
          style={{
            position: "absolute",
            right: -4,
            bottom: -4,
            width: badge,
            height: badge,
            borderRadius: badge / 2,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <DeviceIcon type={type} size={badge * 0.6} color={colors.mutedForeground} />
        </View>
      ) : null}
    </View>
  );
}
