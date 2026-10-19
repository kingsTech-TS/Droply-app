// Six-slot room code entry. Same rules as the website's input: only the room-code alphabet,
// upper-cased, dashes/spaces ignored, paste-friendly. Slots spring when filled and the row
// shakes when `error` changes to true.
import { useEffect, useRef } from "react";
import { Pressable, StyleSheet, TextInput, View, type TextInputInstance } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { haptic } from "@/lib/fun/celebrate";
import { normalizeRoomCode, ROOM_CODE_LENGTH } from "@/lib/utils/room-code";
import { useTheme } from "@/theme/theme-provider";
import { radius, space, springs, type } from "@/theme/tokens";
import { Text } from "./text";

export interface CodeInputProps {
  value: string;
  onChange: (code: string) => void;
  onSubmit?: (code: string) => void;
  error?: boolean;
  autoFocus?: boolean;
}

function Slot({ char, active, filled, error }: { char: string; active: boolean; filled: boolean; error: boolean }) {
  const { colors } = useTheme();
  const scale = useSharedValue(1);
  useEffect(() => {
    if (filled) scale.value = withSequence(withTiming(1.12, { duration: 90 }), withSpring(1, springs.bouncy));
  }, [filled, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View
      style={[
        styles.slot,
        style,
        {
          backgroundColor: colors.card,
          borderColor: error ? colors.destructive : active ? colors.primary : filled ? colors.border : colors.input,
          borderWidth: active ? 2 : 1.5,
        },
      ]}
    >
      <Text style={[type.mono, styles.char]}>{char}</Text>
    </Animated.View>
  );
}

export function CodeInput({ value, onChange, onSubmit, error = false, autoFocus = false }: CodeInputProps) {
  const ref = useRef<TextInputInstance>(null);
  const shake = useSharedValue(0);
  useEffect(() => {
    if (!error) return;
    haptic.error();
    shake.value = withSequence(
      withTiming(-10, { duration: 50 }),
      withTiming(10, { duration: 50 }),
      withTiming(-7, { duration: 50 }),
      withTiming(7, { duration: 50 }),
      withTiming(0, { duration: 50 }),
    );
  }, [error, shake]);
  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  const chars = value.slice(0, ROOM_CODE_LENGTH).split("");

  return (
    <Pressable onPress={() => ref.current?.focus()} accessibilityLabel="Room code" accessibilityHint="Six letters and numbers from the other device">
      <Animated.View style={[styles.row, rowStyle]}>
        {Array.from({ length: ROOM_CODE_LENGTH }, (_, i) => (
          <View key={i} style={i === 3 ? styles.gap : undefined}>
            <Slot char={chars[i] ?? ""} filled={i < chars.length} active={i === Math.min(chars.length, ROOM_CODE_LENGTH - 1)} error={error} />
          </View>
        ))}
      </Animated.View>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={(text) => {
          const next = normalizeRoomCode(text).slice(0, ROOM_CODE_LENGTH);
          onChange(next);
          if (next.length === ROOM_CODE_LENGTH) onSubmit?.(next);
        }}
        autoFocus={autoFocus}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        maxLength={ROOM_CODE_LENGTH + 4}
        returnKeyType="go"
        onSubmitEditing={() => onSubmit?.(value)}
        style={styles.hidden}
        caretHidden
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "center", gap: space.sm },
  gap: { marginLeft: space.sm },
  slot: { width: 46, height: 58, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  char: { fontSize: 24, lineHeight: 30 },
  hidden: { position: "absolute", width: 1, height: 1, opacity: 0 },
});
