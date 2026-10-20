// How long a new room stays open (website: duration-picker.tsx): presets plus a −/+ stepper
// for any minute in between (the website uses a range slider). Remembered between launches.
import { Minus, Plus, Timer } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { LocalStore } from "@/lib/utils/local-store";
import { useTheme } from "@/theme/theme-provider";
import { radius, space } from "@/theme/tokens";
import { ROOM_DEFAULT_MINUTES, ROOM_MAX_MINUTES, ROOM_MIN_MINUTES } from "@/types/room";
import { IconButton } from "@/components/ui/icon-button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";

/** Length of the next room this device creates, in minutes (remembered between launches). */
export const createDuration = new LocalStore<number>("droply:create-duration", ROOM_DEFAULT_MINUTES, (raw) =>
  typeof raw === "number" && Number.isInteger(raw) && raw >= ROOM_MIN_MINUTES && raw <= ROOM_MAX_MINUTES ? raw : null,
);

const PRESETS = [5, 10, 15, 20] as const;

/** Presets and a stepper between `min` and `max` minutes (shared by the Add time sheet). */
export function MinutePicker({
  value,
  onChange,
  min,
  max,
  presets,
  disabled = false,
  label,
  formatPreset = (m) => `${m} min`,
}: {
  value: number;
  onChange: (minutes: number) => void;
  min: number;
  max: number;
  presets: readonly number[];
  disabled?: boolean;
  label: string;
  formatPreset?: (minutes: number) => string;
}) {
  const { colors } = useTheme();
  const set = (m: number) => onChange(Math.min(max, Math.max(min, m)));
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.presets} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {presets.map((m) => {
          const selected = value === m;
          return (
            <PressableScale
              key={m}
              disabled={disabled}
              hapticFeedback="select"
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, disabled }}
              onPress={() => set(m)}
              style={[styles.preset, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primarySoft : colors.card, borderWidth: selected ? 2 : 1 }]}
            >
              <Text variant="footnote" tone={selected ? "primary" : "default"} style={{ fontWeight: selected ? "700" : "500", fontVariant: ["tabular-nums"] }}>
                {formatPreset(m)}
              </Text>
            </PressableScale>
          );
        })}
      </View>
      <View
        style={[styles.stepper, { backgroundColor: colors.muted }]}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min, max, now: value, text: `${value} minutes` }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => set(value + (e.nativeEvent.actionName === "increment" ? 1 : -1))}
      >
        <IconButton icon={Minus} label="One minute less" variant="filled" size={18} disabled={disabled || value <= min} onPress={() => set(value - 1)} />
        <Text variant="headline" style={{ fontVariant: ["tabular-nums"] }}>
          {value} min
        </Text>
        <IconButton icon={Plus} label="One minute more" variant="filled" size={18} disabled={disabled || value >= max} onPress={() => set(value + 1)} />
      </View>
    </View>
  );
}

export function DurationPicker({ value, onChange, disabled = false }: { value: number; onChange: (minutes: number) => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.label}>
        <Timer size={14} color={colors.mutedForeground} />
        <Text variant="footnote" tone="muted">
          Room time: <Text variant="footnote" style={{ fontWeight: "700" }}>{value} min</Text>
        </Text>
      </View>
      <MinutePicker value={value} onChange={onChange} min={ROOM_MIN_MINUTES} max={ROOM_MAX_MINUTES} presets={PRESETS} disabled={disabled} label="Room time in minutes" />
      <Text variant="caption" tone="muted">
        {ROOM_MIN_MINUTES} to {ROOM_MAX_MINUTES} minutes. You can add time once while the room is open.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { flexDirection: "row", alignItems: "center", gap: space.xs },
  presets: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  preset: { minWidth: 64, minHeight: 44, paddingHorizontal: space.md, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: radius.pill, paddingHorizontal: space.xs, paddingVertical: space.xs },
});
