// The website's "💻 ── 📱" connecting animation: a dotted line with a travelling pulse while
// the peer connection is being set up, turning solid once the channel is open.
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useTheme } from "@/theme/theme-provider";

export function ConnectingLine({ connected, color }: { connected: boolean; color?: string }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const pulse = useSharedValue(0);
  const fill = useSharedValue(connected ? 1 : 0);
  const tint = color ?? colors.primary;

  useEffect(() => {
    if (!connected && !reduced) {
      pulse.value = 0;
      pulse.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, false);
    } else {
      cancelAnimation(pulse);
    }
    fill.value = withTiming(connected ? 1 : 0, { duration: 400 });
  }, [connected, reduced, pulse, fill]);

  const dot = useAnimatedStyle(() => ({ transform: [{ translateX: pulse.value * Math.max(0, width - 10) }], opacity: 1 - fill.value }));
  const solid = useAnimatedStyle(() => ({ transform: [{ scaleX: fill.value }] }));

  return (
    <View style={styles.wrap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessible={false}>
      <View style={[styles.dashes, { borderColor: `${tint}66` }]} />
      <Animated.View style={[styles.solid, { backgroundColor: tint }, solid]} />
      <Animated.View style={[styles.dot, { backgroundColor: tint, shadowColor: tint }, dot]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, height: 12, justifyContent: "center" },
  dashes: { position: "absolute", left: 0, right: 0, borderTopWidth: 2, borderStyle: "dashed" },
  solid: { position: "absolute", left: 0, right: 0, height: 3, borderRadius: 2 },
  dot: { position: "absolute", left: 0, width: 10, height: 10, borderRadius: 5, shadowOpacity: 0.6, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
});
