// Full-screen QR scanner. Accepts Droply join links (https://…/join/CODE), personal room links
// (…/r/KEY), droply:// links and bare room codes. The corner brackets "lock" on a match.
import { router } from "expo-router";
import { Camera, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { haptic } from "@/lib/fun/celebrate";
import { parseDroplyLink } from "@/lib/utils/join-url";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/utils/room-code";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { springs } from "@/theme/tokens";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Text } from "@/components/ui/text";

const FRAME = 250;

function Corners({ locked }: { locked: boolean }) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const breathe = useSharedValue(0);
  useEffect(() => {
    if (!reduced) breathe.value = withRepeat(withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [breathe, reduced]);
  useEffect(() => {
    if (locked) scale.value = withSequence(withTiming(0.86, { duration: 120 }), withSpring(0.92, springs.bouncy));
  }, [locked, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value * (1 + breathe.value * 0.03) }] }));
  const color = locked ? "#42c070" : "#ffffff";
  const corner = (pos: object) => <View style={[styles.corner, { borderColor: color }, pos]} />;
  return (
    <Animated.View style={[styles.frame, style]} pointerEvents="none">
      {corner({ top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 22 })}
      {corner({ top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 22 })}
      {corner({ bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 22 })}
      {corner({ bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 22 })}
    </Animated.View>
  );
}

export default function ScanScreen() {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const handled = useRef(false);

  const onScanned = (data: string) => {
    if (handled.current) return;
    const link = parseDroplyLink(data);
    if (!link) {
      setHint("That QR code isn't a Droply room.");
      return;
    }
    if (link.kind === "join" && !isValidRoomCode(normalizeRoomCode(link.code))) {
      setHint("That QR code isn't a Droply room.");
      return;
    }
    handled.current = true;
    setLocked(true);
    haptic.success();
    setTimeout(() => {
      if (link.kind === "join") router.replace({ pathname: "/join/[code]", params: { code: normalizeRoomCode(link.code) } });
      else router.replace({ pathname: "/r/[key]", params: { key: link.key } });
    }, 350);
  };

  if (!permission) return <View style={styles.root} />;

  return (
    <View style={styles.root}>
      {permission.granted ? (
        <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={locked ? undefined : (result) => onScanned(result.data)} />
      ) : (
        <View style={styles.permission}>
          <Camera size={42} color="#ffffff" />
          <Text variant="headline" color="#ffffff" center>
            Scan a room&apos;s QR code
          </Text>
          <Text color="rgba(255,255,255,0.75)" center>
            Droply uses the camera only to read QR codes. Nothing is recorded or uploaded.
          </Text>
          {permission.canAskAgain ? (
            <Button label="Allow camera" onPress={() => void requestPermission()} />
          ) : (
            <Button label="Open Settings" onPress={() => void Linking.openSettings()} />
          )}
        </View>
      )}
      {permission.granted ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <View style={styles.dim} />
          <View style={{ flexDirection: "row" }}>
            <View style={styles.dim} />
            <View style={{ width: FRAME, height: FRAME }}>
              <Corners locked={locked} />
            </View>
            <View style={styles.dim} />
          </View>
          <View style={[styles.dim, { alignItems: "center", paddingTop: 28, paddingHorizontal: 32 }]}>
            <Text variant="subhead" color="#ffffff" center>
              {locked ? "Got it!" : "Point at the QR code on the other device"}
            </Text>
            {hint && !locked ? (
              <Text variant="footnote" color="rgba(255,255,255,0.8)" center style={{ marginTop: 8 }}>
                {hint}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
      <View style={[styles.close, { top: insets.top + 8 }]}>
        <IconButton icon={X} label="Close scanner" color="#ffffff" variant="plain" onPress={() => router.back()} style={{ backgroundColor: "rgba(0,0,0,0.45)" }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000000" },
  dim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  frame: { width: FRAME, height: FRAME },
  corner: { position: "absolute", width: 48, height: 48 },
  permission: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 32 },
  close: { position: "absolute", right: 16 },
});
