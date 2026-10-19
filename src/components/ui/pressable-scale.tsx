// The base of every tappable thing: springs down on press, back up on release, with an
// optional haptic tap. Respects "Reduce motion" (no scaling, just a dim).
import { type ReactNode } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { haptic } from "@/lib/fun/celebrate";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { springs } from "@/theme/tokens";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressableScaleProps extends Omit<PressableProps, "style" | "children"> {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** How far it shrinks while pressed (1 = not at all). */
  scaleTo?: number;
  hapticFeedback?: "tap" | "select" | "none";
}

export function PressableScale({ children, style, scaleTo = 0.96, hapticFeedback = "tap", onPressIn, onPressOut, onPress, disabled, ...props }: PressableScaleProps) {
  const reduced = useReducedMotion();
  const pressed = useSharedValue(0);
  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: reduced ? 1 : 1 - (1 - scaleTo) * pressed.value }],
    opacity: reduced ? 1 - pressed.value * 0.25 : 1,
  }));
  return (
    <AnimatedPressable
      accessibilityRole="button"
      disabled={disabled}
      onPressIn={(event) => {
        pressed.value = withSpring(1, springs.snappy);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        pressed.value = withTiming(0, { duration: 160 });
        onPressOut?.(event);
      }}
      onPress={(event) => {
        if (hapticFeedback === "tap") haptic.tap();
        else if (hapticFeedback === "select") haptic.select();
        onPress?.(event);
      }}
      style={[style, animated, disabled ? { opacity: 0.45 } : null]}
      {...props}
    >
      {children}
    </AnimatedPressable>
  );
}
