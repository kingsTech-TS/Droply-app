// The website's speed graphics: a 30-second sparkline and a log-scale speedometer
// (100 kB/s → 1 GB/s). Decorative: the numbers next to them carry the meaning.
import { useEffect } from "react";
import Animated, { Easing, useAnimatedProps, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Circle, Line, Path, Polyline } from "react-native-svg";
import { useTheme } from "@/theme/theme-provider";

export function Sparkline({ values, width = 120, height = 32, color }: { values: readonly number[]; width?: number; height?: number; color?: string }) {
  const { colors } = useTheme();
  const tint = color ?? colors.electric;
  if (values.length < 2) return <Svg width={width} height={height} />;
  const max = Math.max(...values, 1);
  const step = width / (values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`);
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} accessible={false}>
      <Polyline points={`0,${height} ${points.join(" ")} ${width},${height}`} fill={tint} opacity={0.12} />
      <Polyline points={points.join(" ")} fill="none" stroke={tint} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

const MIN_SPEED = 1e5;
const MAX_SPEED = 1e9;

function gaugeFraction(speed: number): number {
  if (speed <= MIN_SPEED) return 0;
  return Math.min(1, Math.log10(speed / MIN_SPEED) / Math.log10(MAX_SPEED / MIN_SPEED));
}

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedLine = Animated.createAnimatedComponent(Line);

const R = 44;
const CX = 60;
const CY = 56;
const ARC_LENGTH = Math.PI * R;

export function SpeedGauge({ speed, size = 120, color }: { speed: number | null; size?: number; color?: string }) {
  const { colors } = useTheme();
  const tint = color ?? colors.primary;
  const fraction = useSharedValue(0);
  useEffect(() => {
    fraction.value = withTiming(speed ? gaugeFraction(speed) : 0, { duration: 450, easing: Easing.out(Easing.cubic) });
  }, [speed, fraction]);
  const arcProps = useAnimatedProps(() => ({ strokeDashoffset: ARC_LENGTH * (1 - fraction.value) }));
  const needleProps = useAnimatedProps(() => {
    const angle = Math.PI * (1 - fraction.value);
    return { x2: CX + (R - 8) * Math.cos(angle), y2: CY - (R - 8) * Math.sin(angle) };
  });
  const arc = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;
  return (
    <Svg width={size} height={size * 0.6} viewBox="0 0 120 72" accessible={false}>
      <Path d={arc} fill="none" stroke={tint} strokeOpacity={0.15} strokeWidth={10} strokeLinecap="round" />
      <AnimatedPath d={arc} fill="none" stroke={tint} strokeWidth={10} strokeLinecap="round" strokeDasharray={ARC_LENGTH} animatedProps={arcProps} />
      <AnimatedLine x1={CX} y1={CY} stroke={colors.foreground} strokeWidth={3} strokeLinecap="round" animatedProps={needleProps} />
      <Circle cx={CX} cy={CY} r={4} fill={colors.foreground} />
    </Svg>
  );
}
