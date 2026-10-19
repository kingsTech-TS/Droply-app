// Screen scaffold: a large title that collapses into a compact, blurred-looking header as the
// content scrolls (iOS-style, also used on Android), safe-area padding, pull to refresh, and a
// centred max width on tablets.
import { ChevronLeft } from "lucide-react-native";
import { type ReactNode } from "react";
import { RefreshControl, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, { interpolate, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, Extrapolation } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTheme } from "@/theme/theme-provider";
import { space } from "@/theme/tokens";
import { IconButton } from "./icon-button";
import { Text } from "./text";

export interface ScreenProps {
  title?: string;
  subtitle?: string;
  /** Small element above the title (logo, badge). */
  eyebrow?: ReactNode;
  /** Buttons on the right of the header. */
  actions?: ReactNode;
  back?: boolean;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Extra space at the bottom (e.g. above a floating button). */
  bottomInset?: number;
  scroll?: boolean;
}

const COLLAPSE = 56;

export function Screen({ title, subtitle, eyebrow, actions, back = false, children, refreshing, onRefresh, bottomInset = 0, scroll = true }: ScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const y = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    y.value = event.contentOffset.y;
  });
  const compactTitle = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [COLLAPSE - 20, COLLAPSE], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(y.value, [COLLAPSE - 20, COLLAPSE], [6, 0], Extrapolation.CLAMP) }],
  }));
  const headerBorder = useAnimatedStyle(() => ({ opacity: interpolate(y.value, [0, COLLAPSE], [0, 1], Extrapolation.CLAMP) }));
  const largeTitle = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [0, COLLAPSE * 0.8], [1, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(y.value, [-80, 0], [1.08, 1], Extrapolation.CLAMP) }],
  }));

  const contentWidth = Math.min(width, 720);
  const horizontal = width > 720 ? (width - contentWidth) / 2 + space.lg : space.lg;

  const header = (
    <View style={[styles.header, { paddingTop: insets.top, backgroundColor: colors.background }]}>
      <View style={styles.headerRow}>
        <View style={styles.side}>{back ? <IconButton icon={ChevronLeft} label="Back" size={26} onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} /> : null}</View>
        <Animated.View style={[styles.compactTitle, compactTitle]} pointerEvents="none">
          {title ? (
            <Text variant="subhead" numberOfLines={1}>
              {title}
            </Text>
          ) : null}
        </Animated.View>
        <View style={[styles.side, styles.actions]}>{actions}</View>
      </View>
      <Animated.View style={[styles.border, { backgroundColor: colors.border }, headerBorder]} />
    </View>
  );

  const body = (
    <>
      {title || eyebrow ? (
        <Animated.View style={[styles.largeTitle, largeTitle]}>
          {eyebrow}
          {title ? (
            <Text variant="title" accessibilityRole="header">
              {title}
            </Text>
          ) : null}
          {subtitle ? (
            <Text variant="callout" tone="muted">
              {subtitle}
            </Text>
          ) : null}
        </Animated.View>
      ) : null}
      {children}
    </>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {scroll ? (
        <Animated.ScrollView
          onScroll={onScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingTop: insets.top + 52, paddingBottom: insets.bottom + space.huge + bottomInset, paddingHorizontal: horizontal }}
          refreshControl={onRefresh ? <RefreshControl refreshing={refreshing ?? false} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} progressViewOffset={insets.top + 52} /> : undefined}
        >
          {body}
        </Animated.ScrollView>
      ) : (
        <View style={{ flex: 1, paddingTop: insets.top + 52, paddingHorizontal: horizontal, paddingBottom: insets.bottom }}>{body}</View>
      )}
      {header}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { position: "absolute", top: 0, left: 0, right: 0 },
  headerRow: { height: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: space.xs },
  side: { minWidth: 48, flexDirection: "row", alignItems: "center" },
  actions: { justifyContent: "flex-end" },
  compactTitle: { flex: 1, alignItems: "center" },
  border: { height: StyleSheet.hairlineWidth },
  largeTitle: { gap: space.xs, marginTop: space.sm, marginBottom: space.lg },
});
