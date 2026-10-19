// Section headers, empty states, skeletons and banners.
import type { LucideIcon } from "lucide-react-native";
import { useEffect, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useTheme } from "@/theme/theme-provider";
import { radius, space } from "@/theme/tokens";
import { Text } from "./text";

export function SectionHeader({ title, icon: Icon, action }: { title: string; icon?: LucideIcon; action?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section} accessibilityRole="header">
      <View style={styles.sectionTitle}>
        {Icon ? <Icon size={15} color={colors.mutedForeground} strokeWidth={2.4} /> : null}
        <Text variant="overline" tone="muted">
          {title}
        </Text>
      </View>
      {action}
    </View>
  );
}

export function EmptyState({ icon: Icon, emoji, title, body, action }: { icon?: LucideIcon; emoji?: string; title: string; body?: string; action?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Animated.View entering={FadeIn.duration(300)} style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
        {emoji ? <Text style={{ fontSize: 34, lineHeight: 42 }}>{emoji}</Text> : Icon ? <Icon size={30} color={colors.primary} strokeWidth={2} /> : null}
      </View>
      <Text variant="subhead" center>
        {title}
      </Text>
      {body ? (
        <Text variant="callout" tone="muted" center style={{ maxWidth: 320 }}>
          {body}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: space.sm }}>{action}</View> : null}
    </Animated.View>
  );
}

export function Skeleton({ width = "100%", height = 16, style }: { width?: number | `${number}%`; height?: number; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0.5);
  useEffect(() => {
    if (!reduced) pulse.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
  }, [pulse, reduced]);
  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return <Animated.View style={[{ width, height, borderRadius: radius.sm, backgroundColor: colors.muted }, animated, style]} />;
}

export type BannerTone = "info" | "warning" | "error" | "success";

export function Banner({ icon: Icon, tone = "info", children, action }: { icon?: LucideIcon; tone?: BannerTone; children: ReactNode; action?: ReactNode }) {
  const { colors } = useTheme();
  const map = {
    info: { bg: colors.electricSoft, fg: colors.electric },
    warning: { bg: colors.warningSoft, fg: colors.warning },
    error: { bg: colors.destructiveSoft, fg: colors.destructive },
    success: { bg: colors.successSoft, fg: colors.success },
  }[tone];
  return (
    <Animated.View entering={FadeIn.duration(200)} accessibilityRole="alert" style={[styles.banner, { backgroundColor: map.bg }]}>
      {Icon ? <Icon size={18} color={map.fg} strokeWidth={2.2} /> : null}
      <View style={{ flex: 1 }}>{typeof children === "string" ? <Text variant="footnote" color={map.fg} style={{ fontWeight: "600" }}>{children}</Text> : children}</View>
      {action}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  section: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space.xl, marginBottom: space.sm },
  sectionTitle: { flexDirection: "row", alignItems: "center", gap: space.xs + 2 },
  empty: { alignItems: "center", gap: space.sm, paddingVertical: space.xxxl, paddingHorizontal: space.xl },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: space.sm },
  banner: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, borderRadius: radius.lg },
});
