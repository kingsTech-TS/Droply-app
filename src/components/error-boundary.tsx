// The website's app/error.tsx: a friendly screen with "Try again" instead of a crash. Uses
// plain primitives on purpose: it must render even if the theme or providers failed.
import { RotateCcw, TriangleAlert } from "lucide-react-native";
import type { ErrorBoundaryProps } from "expo-router";
import { Pressable, Text, useColorScheme, View } from "react-native";
import { logger } from "@/lib/utils/logger";
import { PALETTE } from "@/theme/palette.generated";

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  logger.error("app", "unhandled error", error.message);
  const p = useColorScheme() === "dark" ? PALETTE.dark : PALETTE.light;
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 16, backgroundColor: p.background }}>
      <TriangleAlert size={40} color={p.warning} />
      <Text style={{ color: p.foreground, fontSize: 20, fontWeight: "700", textAlign: "center" }}>Something went wrong</Text>
      <Text style={{ color: p.mutedForeground, fontSize: 15, textAlign: "center" }}>Your transfers on other devices are not affected. Try again.</Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => void retry()}
        style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: p.primary, paddingHorizontal: 20, minHeight: 48, borderRadius: 12 }}
      >
        <RotateCcw size={18} color={p.primaryForeground} />
        <Text style={{ color: p.primaryForeground, fontSize: 16, fontWeight: "600" }}>Try again</Text>
      </Pressable>
    </View>
  );
}
