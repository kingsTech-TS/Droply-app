// Bottom sheet (the website's dialogs): springs up over a dimmed backdrop, drag the handle or
// header down to dismiss, tap the backdrop to close. Keyboard-aware, safe-area aware, and
// capped at 92% of the screen with scrollable content.
import type { LucideIcon } from "lucide-react-native";
import { X } from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useTheme } from "@/theme/theme-provider";
import { radius, space, springs } from "@/theme/tokens";
import { IconButton } from "./icon-button";
import { Text } from "./text";

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  icon?: LucideIcon;
  children: ReactNode;
  footer?: ReactNode;
  /** Wrap the content in a ScrollView (default true). */
  scroll?: boolean;
  /** Prevent closing (e.g. while a speed test runs). */
  locked?: boolean;
}

export function Sheet({ visible, onClose, title, subtitle, icon: Icon, children, footer, scroll = true, locked = false }: SheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const translate = useSharedValue(screenHeight);
  const backdrop = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      // Mount before animating in; unmounting waits for the close animation.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(true);
      translate.value = screenHeight;
      translate.value = reduced ? withTiming(0, { duration: 150 }) : withSpring(0, springs.gentle);
      backdrop.value = withTiming(1, { duration: 220 });
    } else if (mounted) {
      backdrop.value = withTiming(0, { duration: 180 });
      translate.value = withTiming(screenHeight, { duration: 220, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(setMounted)(false);
      });
    }
    // `mounted` intentionally omitted: it only gates the close animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, screenHeight, reduced]);

  const requestClose = () => {
    if (!locked) onClose();
  };

  const pan = usePanGesture({
    enabled: !locked,
    activeOffsetY: 8,
    onUpdate: (event) => {
      "worklet";
      translate.set(Math.max(0, event.translationY));
    },
    onDeactivate: (event) => {
      "worklet";
      if (event.translationY > 120 || event.velocityY > 900) {
        runOnJS(onClose)();
      } else {
        translate.set(withSpring(0, springs.snappy));
      }
    },
  });

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translate.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));

  if (!mounted) return null;
  const maxWidth = Math.min(640, screenWidth);

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={requestClose}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={requestClose} accessibilityLabel="Close" accessibilityRole="button" />
      </Animated.View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.container} pointerEvents="box-none">
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.panel,
            panelStyle,
            {
              backgroundColor: colors.background,
              maxHeight: screenHeight * 0.92,
              width: maxWidth,
              paddingBottom: Math.max(insets.bottom, space.lg),
            },
          ]}
        >
          <GestureDetector gesture={pan}>
            <View>
              <View style={styles.handleArea}>
                <View style={[styles.handle, { backgroundColor: colors.border }]} />
              </View>
              {title ? (
                <View style={styles.header}>
                  {Icon ? (
                    <View style={[styles.headerIcon, { backgroundColor: colors.primarySoft }]}>
                      <Icon size={20} color={colors.primary} strokeWidth={2.2} />
                    </View>
                  ) : null}
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text variant="headline" accessibilityRole="header">
                      {title}
                    </Text>
                    {subtitle ? (
                      <Text variant="footnote" tone="muted">
                        {subtitle}
                      </Text>
                    ) : null}
                  </View>
                  {!locked ? <IconButton icon={X} label="Close" variant="filled" size={18} onPress={onClose} /> : null}
                </View>
              ) : null}
            </View>
          </GestureDetector>
          {scroll ? (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {children}
            </ScrollView>
          ) : (
            <View style={[styles.content, { flexShrink: 1 }]}>{children}</View>
          )}
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "flex-end", alignItems: "center" },
  panel: { borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, overflow: "hidden" },
  handleArea: { alignItems: "center", paddingTop: space.sm, paddingBottom: space.xs },
  handle: { width: 40, height: 5, borderRadius: 3 },
  header: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.xl, paddingTop: space.sm, paddingBottom: space.md },
  headerIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: space.xl, paddingBottom: space.md, gap: space.lg },
  footer: { paddingHorizontal: space.xl, paddingTop: space.sm, gap: space.sm },
});
