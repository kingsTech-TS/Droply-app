// Completion mark: the ring fills, then the check stroke draws itself, with a little pop.
import { useEffect } from "react";
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useTheme } from "@/theme/theme-provider";
import { springs } from "@/theme/tokens";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

const RING = 2 * Math.PI * 20;
const CHECK = 30;

export function CheckDraw({ size = 28, color }: { size?: number; color?: string }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const tint = color ?? colors.success;
  const ring = useSharedValue(reduced ? 1 : 0);
  const check = useSharedValue(reduced ? 1 : 0);
  const pop = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    ring.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) });
    check.value = withDelay(320, withTiming(1, { duration: 300, easing: Easing.out(Easing.quad) }));
    pop.value = withDelay(560, withSequence(withTiming(1.15, { duration: 120 }), withSpring(1, springs.bouncy)));
  }, [reduced, ring, check, pop]);
  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: RING * (1 - ring.value) }));
  const checkProps = useAnimatedProps(() => ({ strokeDashoffset: CHECK * (1 - check.value) }));
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  return (
    <Animated.View style={popStyle} accessible={false}>
      <Svg width={size} height={size} viewBox="0 0 48 48">
        <Circle cx={24} cy={24} r={20} fill={`${tint}22`} />
        <AnimatedCircle cx={24} cy={24} r={20} stroke={tint} strokeWidth={3.5} fill="none" strokeDasharray={RING} animatedProps={ringProps} strokeLinecap="round" rotation={-90} origin="24,24" />
        <AnimatedPath d="M15 25 l6 6 l12 -13" stroke={tint} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={CHECK} animatedProps={checkProps} />
      </Svg>
    </Animated.View>
  );
}
