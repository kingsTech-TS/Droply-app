// "Waiting for another device…": rings ripple out from this device's avatar.
import { useEffect, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withTiming, type SharedValue } from "react-native-reanimated";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useTheme } from "@/theme/theme-provider";

function Ring({ progress, size, color }: { progress: SharedValue<number>; size: number; color: string }) {
  const style = useAnimatedStyle(() => ({
    opacity: (1 - progress.value) * 0.55,
    transform: [{ scale: 0.6 + progress.value * 1.6 }],
  }));
  return <Animated.View style={[styles.ring, { width: size, height: size, borderRadius: size / 2, borderColor: color, backgroundColor: `${color}14` }, style]} />;
}

export function RadarPulse({ size = 96, children }: { size?: number; children?: ReactNode }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const a = useSharedValue(0);
  const b = useSharedValue(0);
  const c = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    const loop = (delay: number) => withDelay(delay, withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1, false));
    a.value = loop(0);
    b.value = loop(800);
    c.value = loop(1600);
  }, [a, b, c, reduced]);
  return (
    <View style={[styles.wrap, { width: size * 2.6, height: size * 2.6 }]} accessible={false}>
      {!reduced ? (
        <>
          <Ring progress={a} size={size} color={colors.primary} />
          <Ring progress={b} size={size} color={colors.primary} />
          <Ring progress={c} size={size} color={colors.electric} />
        </>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", borderWidth: 2 },
});
