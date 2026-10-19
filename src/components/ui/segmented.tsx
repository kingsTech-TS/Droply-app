// Pill segmented control with a sliding indicator (filters, periods, test sizes).
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { haptic } from "@/lib/fun/celebrate";
import { useTheme } from "@/theme/theme-provider";
import { radius, space, springs } from "@/theme/tokens";
import { Text } from "./text";

export interface SegmentedProps<T extends string> {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
}

export function Segmented<T extends string>({ options, value, onChange, accessibilityLabel }: SegmentedProps<T>) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const segment = width > 0 ? (width - 8) / options.length : 0;
  const x = useSharedValue(index * segment);
  useEffect(() => {
    x.value = withSpring(index * segment, springs.snappy);
  }, [index, segment, x]);
  const indicator = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }], width: segment }));

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[styles.track, { backgroundColor: colors.muted }]}
    >
      {segment > 0 ? <Animated.View style={[styles.indicator, { backgroundColor: colors.card, shadowColor: colors.shadow }, indicator]} /> : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              if (!selected) haptic.select();
              onChange(option.value);
            }}
            style={styles.option}
          >
            <Text variant="footnote" tone={selected ? "default" : "muted"} style={{ fontWeight: selected ? "700" : "500" }} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: "row", padding: 4, borderRadius: radius.pill, minHeight: 44 },
  indicator: {
    position: "absolute",
    top: 4,
    bottom: 4,
    left: 4,
    borderRadius: radius.pill,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  option: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.sm },
});
