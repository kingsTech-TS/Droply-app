// Confirmation dialogs (the website's AlertDialogs), drawn in the app's own style instead of
// the system alert: a card that springs in over a dimmed backdrop. `confirm()` resolves true
// when confirmed; the backdrop, Cancel and the Android back button resolve false.
import { TriangleAlert } from "lucide-react-native";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from "react-native-reanimated";
import { haptic } from "@/lib/fun/celebrate";
import { Store } from "@/lib/utils/emitter";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useTheme } from "@/theme/theme-provider";
import { elevation, radius, space } from "@/theme/tokens";
import { Button } from "./button";
import { sheetsClosing } from "./sheet";
import { Text } from "./text";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface Request extends ConfirmOptions {
  id: number;
  resolve: (ok: boolean) => void;
}

const queue = new Store<Request[]>([]);
let nextId = 1;

export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    queue.update((list) => [...list, { ...options, id: nextId++, resolve }]);
  });
}

function settle(request: Request, ok: boolean): void {
  queue.update((list) => list.filter((r) => r.id !== request.id));
  request.resolve(ok);
}

/** Mounted once in the root layout. Shows one confirmation at a time. */
export function ConfirmHost() {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const requests = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  // Wait for a closing sheet to finish first: on iOS a modal presented while another is
  // being dismissed is dismissed along with it.
  const closing = useSyncExternalStore(sheetsClosing.subscribe, sheetsClosing.getSnapshot, sheetsClosing.getSnapshot);
  const request = closing > 0 ? undefined : requests[0];
  const [shownId, setShownId] = useState<number | null>(null);

  useEffect(() => {
    if (!request || request.id === shownId) return;
    // Haptic once per dialog, when it appears.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShownId(request.id);
    if (request.destructive) haptic.warning();
    else haptic.select();
  }, [request, shownId]);

  if (!request) return null;
  const { title, message, confirmLabel, cancelLabel = "Cancel", destructive = false } = request;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={() => settle(request, false)}>
      <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)} style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => settle(request, false)} accessibilityRole="button" accessibilityLabel={cancelLabel} />
      </Animated.View>
      <View style={styles.center} pointerEvents="box-none">
        <Animated.View
          key={request.id}
          entering={reduced ? FadeIn.duration(150) : ZoomIn.springify().damping(18).stiffness(260)}
          exiting={reduced ? FadeOut.duration(120) : ZoomOut.duration(140)}
          accessibilityViewIsModal
          accessibilityRole="alert"
          style={[styles.card, elevation(3, colors), { backgroundColor: colors.popover, borderColor: colors.border }]}
        >
          {destructive ? (
            <View style={[styles.icon, { backgroundColor: colors.destructiveSoft }]}>
              <TriangleAlert size={22} color={colors.destructive} strokeWidth={2.3} />
            </View>
          ) : null}
          <Text variant="headline" center>
            {title}
          </Text>
          {message ? (
            <Text variant="callout" tone="muted" center>
              {message}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <View style={{ flex: 1 }}>
              <Button label={cancelLabel} variant="secondary" fullWidth onPress={() => settle(request, false)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label={confirmLabel} variant={destructive ? "destructive" : "primary"} fullWidth onPress={() => settle(request, true)} />
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl },
  card: { width: "100%", maxWidth: 380, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, padding: space.xl, gap: space.md, alignItems: "center" },
  icon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: space.xs },
  actions: { flexDirection: "row", gap: space.sm, alignSelf: "stretch", marginTop: space.sm },
});
