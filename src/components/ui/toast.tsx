// Toasts (the website uses Sonner): sparing, short, with an optional action. Slide in from
// the top under the status bar, auto-dismiss, tap to dismiss, with matching haptics.
import { CircleCheck, Info, TriangleAlert, XCircle } from "lucide-react-native";
import { useEffect, useSyncExternalStore } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeOutUp, LinearTransition, SlideInUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptic } from "@/lib/fun/celebrate";
import { Store } from "@/lib/utils/emitter";
import { useTheme } from "@/theme/theme-provider";
import { elevation, radius, space } from "@/theme/tokens";
import { Text } from "./text";

export type ToastKind = "success" | "error" | "warning" | "info";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  description?: string;
  action?: { label: string; onPress: () => void };
  duration: number;
}

interface ToastOptions {
  description?: string;
  action?: { label: string; onPress: () => void };
  duration?: number;
}

const store = new Store<ToastItem[]>([]);
let nextId = 1;
const MAX_VISIBLE = 3;

function push(kind: ToastKind, message: string, options: ToastOptions = {}): void {
  const item: ToastItem = { id: nextId++, kind, message, duration: options.duration ?? (options.action ? 6000 : 4000), ...options };
  store.update((list) => [...list, item].slice(-MAX_VISIBLE));
  if (kind === "success") haptic.success();
  else if (kind === "error") haptic.error();
  else if (kind === "warning") haptic.warning();
}

function dismiss(id: number): void {
  store.update((list) => list.filter((t) => t.id !== id));
}

export const toast = Object.assign((message: string, options?: ToastOptions) => push("info", message, options), {
  success: (message: string, options?: ToastOptions) => push("success", message, options),
  error: (message: string, options?: ToastOptions) => push("error", message, options),
  warning: (message: string, options?: ToastOptions) => push("warning", message, options),
  info: (message: string, options?: ToastOptions) => push("info", message, options),
});

function ToastView({ item }: { item: ToastItem }) {
  const { colors } = useTheme();
  useEffect(() => {
    const timer = setTimeout(() => dismiss(item.id), item.duration);
    return () => clearTimeout(timer);
  }, [item.id, item.duration]);
  const Icon = { success: CircleCheck, error: XCircle, warning: TriangleAlert, info: Info }[item.kind];
  const tint = { success: colors.success, error: colors.destructive, warning: colors.warning, info: colors.primary }[item.kind];
  return (
    <Animated.View entering={SlideInUp.springify().damping(18)} exiting={FadeOutUp.duration(180)} layout={LinearTransition.springify()}>
      <Pressable
        onPress={() => dismiss(item.id)}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        accessibilityHint="Tap to dismiss"
        style={[styles.toast, elevation(3, colors), { backgroundColor: colors.popover, borderColor: colors.border }]}
      >
        <Icon size={20} color={tint} strokeWidth={2.3} />
        <View style={styles.body}>
          <Text variant="callout" style={{ fontWeight: "600" }}>
            {item.message}
          </Text>
          {item.description ? (
            <Text variant="footnote" tone="muted">
              {item.description}
            </Text>
          ) : null}
        </View>
        {item.action ? (
          <Pressable
            hitSlop={8}
            onPress={() => {
              item.action?.onPress();
              dismiss(item.id);
            }}
            style={[styles.action, { backgroundColor: colors.primarySoft }]}
            accessibilityRole="button"
          >
            <Text variant="footnote" tone="primary" style={{ fontWeight: "700" }}>
              {item.action.label}
            </Text>
          </Pressable>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

/** Mount once at the root, above everything. */
export function Toaster() {
  const items = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { paddingTop: insets.top + space.sm }]}>
      <View pointerEvents="box-none" style={styles.stack}>
        {items.map((item) => (
          <ToastView key={item.id} item={item} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.sm, paddingHorizontal: space.lg, alignItems: "stretch", maxWidth: 560, width: "100%", alignSelf: "center" },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  body: { flex: 1, gap: 2 },
  action: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill },
});
