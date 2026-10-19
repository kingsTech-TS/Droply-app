// Progress bar driven on the UI thread: the value arrives at most 5×/s from the transfer
// store and is eased between updates, so the bar glides instead of stepping. A light sheen
// sweeps across while active (off with Reduce motion).
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming, cancelAnimation } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useTheme } from "@/theme/theme-provider";
import { alpha, radius } from "@/theme/tokens";

export type ProgressTone = "default" | "paused" | "success" | "error";

export interface ProgressBarProps {
  /** 0–1. */
  value: number;
  tone?: ProgressTone;
  active?: boolean;
  height?: number;
  accessibilityLabel?: string;
  accessibilityValueText?: string;
}

export function ProgressBar({ value, tone = "default", active = false, height = 8, accessibilityLabel, accessibilityValueText }: ProgressBarProps) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const progress = useSharedValue(value);
  const sheen = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(Math.max(0, Math.min(1, value)), { duration: reduced ? 0 : 350, easing: Easing.out(Easing.cubic) });
  }, [value, progress, reduced]);

  useEffect(() => {
    if (active && !reduced) {
      sheen.value = 0;
      sheen.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }), -1, false);
    } else {
      cancelAnimation(sheen);
      sheen.value = 0;
    }
  }, [active, reduced, sheen]);

  const color = { default: colors.primary, paused: colors.warning, success: colors.success, error: colors.destructive }[tone];
  const fill = useAnimatedStyle(() => ({ width: Math.max(progress.value > 0 ? height : 0, progress.value * width) }));
  const sheenStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -80 + sheen.value * (width + 160) }], opacity: active ? 1 : 0 }));

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.floor(value * 100), text: accessibilityValueText }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[styles.track, { height, backgroundColor: colors.muted, borderRadius: radius.pill }]}
    >
      <Animated.View style={[styles.fill, { backgroundColor: color, borderRadius: radius.pill }, fill]}>
        <Animated.View style={[styles.sheen, sheenStyle]}>
          <LinearGradient
            colors={[alpha("#ffffff", 0), alpha("#ffffff", 0.45), alpha("#ffffff", 0)]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { overflow: "hidden", width: "100%" },
  fill: { height: "100%", overflow: "hidden" },
  sheen: { position: "absolute", top: 0, bottom: 0, width: 80 },
});
