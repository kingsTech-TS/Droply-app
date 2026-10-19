import { forwardRef, useState } from "react";
import { StyleSheet, TextInput, View, type TextInputInstance, type TextInputProps } from "react-native";
import { useTheme } from "@/theme/theme-provider";
import { radius, space, type } from "@/theme/tokens";
import { Text } from "./text";

export interface InputProps extends TextInputProps {
  label?: string;
  hint?: string;
  error?: string | null;
  right?: React.ReactNode;
  left?: React.ReactNode;
}

export const Input = forwardRef<TextInputInstance, InputProps>(function Input({ label, hint, error, right, left, style, onFocus, onBlur, multiline, ...props }, ref) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.wrap}>
      {label ? (
        <Text variant="footnote" tone="muted" style={styles.label}>
          {label}
        </Text>
      ) : null}
      <View
        style={[
          styles.field,
          {
            backgroundColor: colors.card,
            borderColor: error ? colors.destructive : focused ? colors.ring : colors.input,
            minHeight: multiline ? 110 : 52,
            alignItems: multiline ? "flex-start" : "center",
          },
        ]}
      >
        {left}
        <TextInput
          ref={ref}
          placeholderTextColor={colors.mutedForeground}
          selectionColor={colors.primary}
          multiline={multiline}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[type.body, styles.input, { color: colors.foreground, textAlignVertical: multiline ? "top" : "center" }, style]}
          accessibilityLabel={props.accessibilityLabel ?? label}
          {...props}
        />
        {right}
      </View>
      {error ? (
        <Text variant="footnote" tone="destructive" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="footnote" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  label: { fontWeight: "600" },
  field: { flexDirection: "row", gap: space.sm, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.md },
  input: { flex: 1, paddingVertical: space.md },
});
