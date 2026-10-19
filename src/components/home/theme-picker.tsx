// The theme for the next room this device creates (remembered), as on the website.
import { ScrollView, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, withSpring } from "react-native-reanimated";
import { THEME_STYLES } from "@/lib/fun/themes";
import { LocalStore } from "@/lib/utils/local-store";
import { useTheme } from "@/theme/theme-provider";
import { radius, space, springs } from "@/theme/tokens";
import { ROOM_THEMES, type RoomTheme } from "@/types/room";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Text } from "@/components/ui/text";

export const createTheme = new LocalStore<RoomTheme>("droply:create-theme", "default", (raw) =>
  typeof raw === "string" && (ROOM_THEMES as readonly string[]).includes(raw) ? (raw as RoomTheme) : null,
);

function Swatch({ theme, selected, onPress, disabled }: { theme: RoomTheme; selected: boolean; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  const style = useAnimatedStyle(() => ({ transform: [{ scale: withSpring(selected ? 1.12 : 1, springs.bouncy) }] }));
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      hapticFeedback="select"
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={THEME_STYLES[theme].label}
    >
      <Animated.View
        style={[
          styles.swatch,
          style,
          { backgroundColor: selected ? colors.primarySoft : colors.card, borderColor: selected ? colors.primary : colors.border, borderWidth: selected ? 2 : 1 },
        ]}
      >
        <Text style={{ fontSize: 22, lineHeight: 28 }}>{THEME_STYLES[theme].emoji}</Text>
      </Animated.View>
    </PressableScale>
  );
}

export function ThemePicker({ value, onChange, disabled = false }: { value: RoomTheme; onChange: (theme: RoomTheme) => void; disabled?: boolean }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="footnote" tone="muted">
        Room theme: <Text variant="footnote" style={{ fontWeight: "700" }}>{THEME_STYLES[value].label}</Text>
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} accessibilityRole="radiogroup">
        {ROOM_THEMES.map((theme) => (
          <Swatch key={theme} theme={theme} selected={value === theme} onPress={() => onChange(theme)} disabled={disabled} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.sm, paddingVertical: space.xs, paddingHorizontal: 2 },
  swatch: { width: 48, height: 48, borderRadius: radius.pill, alignItems: "center", justifyContent: "center" },
});
