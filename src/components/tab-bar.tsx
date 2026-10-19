// Bottom tab bar: a floating card with a sliding pill behind the active tab, icons that
// pop when selected, a live badge on Transfers, and selection haptics.
import type { BottomTabBarProps } from "expo-router/build/layouts/Tabs";
import { ArrowDownUp, Clock, House, Settings, type LucideIcon } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptic } from "@/lib/fun/celebrate";
import { useTheme } from "@/theme/theme-provider";
import { elevation, radius, space, springs } from "@/theme/tokens";
import { Text } from "@/components/ui/text";

const ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  index: { icon: House, label: "Home" },
  transfers: { icon: ArrowDownUp, label: "Transfers" },
  history: { icon: Clock, label: "History" },
  settings: { icon: Settings, label: "Settings" },
};

function TabIcon({ icon: Icon, focused, color }: { icon: LucideIcon; focused: boolean; color: string }) {
  const scale = useSharedValue(1);
  useEffect(() => {
    if (focused) scale.value = withSequence(withTiming(0.85, { duration: 80 }), withSpring(1.08, springs.bouncy), withSpring(1, springs.snappy));
  }, [focused, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={style}>
      <Icon size={22} color={color} strokeWidth={focused ? 2.5 : 2} />
    </Animated.View>
  );
}

export function TabBar({ state, navigateToTab, descriptors, badges = {} }: BottomTabBarProps & { badges?: Record<string, number> }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [width, setWidth] = useState(0);
  const count = state.routes.length;
  const tabWidth = width > 0 ? (width - space.sm * 2) / count : 0;
  const x = useSharedValue(state.index * tabWidth);
  useEffect(() => {
    x.value = withSpring(state.index * tabWidth, springs.snappy);
  }, [state.index, tabWidth, x]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }], width: tabWidth }));

  return (
    <View style={[styles.outer, { paddingBottom: Math.max(insets.bottom, space.sm) }]} pointerEvents="box-none">
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={[styles.bar, elevation(3, colors), { backgroundColor: colors.card, borderColor: colors.border }]}
        accessibilityRole="tablist"
      >
        {tabWidth > 0 ? <Animated.View style={[styles.pill, { backgroundColor: colors.primarySoft }, pill]} /> : null}
        {state.routes.map((route, index) => {
          const meta = ICONS[route.name] ?? { icon: House, label: descriptors[route.key]?.options.title ?? route.name };
          const focused = state.index === index;
          const color = focused ? colors.primary : colors.mutedForeground;
          const badge = badges[route.name] ?? 0;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={badge ? `${meta.label}, ${badge} active` : meta.label}
              onPress={() => {
                if (!focused) haptic.select();
                navigateToTab(route.key);
              }}
              style={styles.tab}
            >
              <View>
                <TabIcon icon={meta.icon} focused={focused} color={color} />
                {badge > 0 ? (
                  <View style={[styles.badge, { backgroundColor: colors.primary, borderColor: colors.card }]}>
                    <Text style={styles.badgeText} color={colors.primaryForeground}>
                      {badge > 9 ? "9+" : badge}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text variant="caption" color={color} style={{ fontWeight: focused ? "700" : "500" }} numberOfLines={1}>
                {meta.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: space.lg, alignItems: "center" },
  bar: {
    flexDirection: "row",
    width: "100%",
    maxWidth: 520,
    padding: space.sm,
    borderRadius: radius.xxl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pill: { position: "absolute", top: space.sm, bottom: space.sm, left: space.sm, borderRadius: radius.xl },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2, minHeight: 52 },
  badge: { position: "absolute", top: -6, right: -10, minWidth: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  badgeText: { fontSize: 10, lineHeight: 12, fontWeight: "800" },
});

export const TAB_BAR_SPACE = 96;
