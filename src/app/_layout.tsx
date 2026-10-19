import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import { SplashScreen, Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { configureNotifications } from "@/lib/notifications/notifications";
import { wireQueryManagers } from "@/lib/query";
import { ThemeProvider, useTheme } from "@/theme/theme-provider";
import { EffectsOverlay } from "@/components/motion/effects-overlay";
import { ResultCardHost } from "@/components/share/result-card";
import { SessionEffects } from "@/components/session-effects";
import { Toaster } from "@/components/ui/toast";

export { ErrorBoundary } from "@/components/error-boundary";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);
wireQueryManagers();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 5_000, refetchOnWindowFocus: false } },
});

function RootStack() {
  const { colors, scheme } = useTheme();
  useEffect(() => {
    configureNotifications();
    const timer = setTimeout(() => void SplashScreen.hideAsync().catch(() => undefined), 50);
    return () => clearTimeout(timer);
  }, []);
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: "slide_from_right",
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
        }}
      >
        <Stack.Screen name="(tabs)" options={{ animation: "fade" }} />
        <Stack.Screen name="room/[roomId]" options={{ animation: "slide_from_bottom", gestureEnabled: false }} />
        <Stack.Screen name="join/[code]" options={{ presentation: "modal" }} />
        <Stack.Screen name="r/[key]" options={{ presentation: "modal" }} />
        <Stack.Screen name="scan" options={{ presentation: "fullScreenModal", animation: "fade" }} />
        <Stack.Screen name="present" options={{ presentation: "fullScreenModal", animation: "fade" }} />
      </Stack>
      <SessionEffects />
      <EffectsOverlay />
      <Toaster />
      <ResultCardHost />
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <RootStack />
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
