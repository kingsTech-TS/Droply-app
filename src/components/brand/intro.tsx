// Opening animation, once per launch. It starts as an exact copy of the native splash (same
// background, same 140px icon, see app.json) so the hand-off is invisible, then the icon
// settles to the left while "Droply" slides in beside it, and the overlay fades into the app.
import { useEffect, useState } from "react";
import { Image, StyleSheet, useColorScheme } from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { brand } from "@/config/brand";
import { haptic } from "@/lib/fun/celebrate";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { type } from "@/theme/tokens";

/** Matches the expo-splash-screen plugin in app.json. */
const SPLASH = { light: "#F7F8FC", dark: "#0E1020", imageWidth: 140 } as const;
const MARK = 64;
const GAP = 14;

let played = false;

export function Intro() {
  const [done, setDone] = useState(played);
  if (done) return null;
  return (
    <IntroAnimation
      onDone={() => {
        played = true;
        setDone(true);
      }}
    />
  );
}

function IntroAnimation({ onDone }: { onDone: () => void }) {
  const dark = useColorScheme() === "dark";
  const reduced = useReducedMotion();
  const [wordWidth, setWordWidth] = useState(0);

  const markScale = useSharedValue(SPLASH.imageWidth / MARK);
  const markShift = useSharedValue(0);
  const wordOpacity = useSharedValue(0);
  const wordShift = useSharedValue(-18);
  const overlayOpacity = useSharedValue(1);
  const overlayScale = useSharedValue(1);

  useEffect(() => {
    if (wordWidth === 0) return;
    const centered = (wordWidth + GAP) / 2;
    // Start centered, exactly where the native splash drew the icon.
    markShift.set(centered);
    const finish = () => {
      "worklet";
      runOnJS(onDone)();
    };
    if (reduced) {
      markScale.set(1);
      markShift.set(0);
      wordShift.set(0);
      wordOpacity.set(withTiming(1, { duration: 200 }));
      overlayOpacity.set(withDelay(700, withTiming(0, { duration: 250 }, (ok) => ok && finish())));
      return;
    }
    markScale.set(withSequence(withTiming(SPLASH.imageWidth / MARK * 0.92, { duration: 140, easing: Easing.out(Easing.quad) }), withSpring(1, { damping: 13, stiffness: 140 })));
    markShift.set(withDelay(140, withSpring(0, { damping: 16, stiffness: 120 })));
    wordOpacity.set(withDelay(420, withTiming(1, { duration: 320 })));
    wordShift.set(withDelay(420, withSpring(0, { damping: 15, stiffness: 150 })));
    overlayScale.set(withDelay(1450, withTiming(1.08, { duration: 320, easing: Easing.in(Easing.cubic) })));
    overlayOpacity.set(withDelay(1450, withTiming(0, { duration: 320, easing: Easing.in(Easing.cubic) }, (ok) => ok && finish())));
    const tick = setTimeout(() => haptic.select(), 450);
    return () => clearTimeout(tick);
  }, [wordWidth, reduced, onDone, markScale, markShift, wordOpacity, wordShift, overlayOpacity, overlayScale]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.get() }));
  const contentStyle = useAnimatedStyle(() => ({ transform: [{ scale: overlayScale.get() }] }));
  const markStyle = useAnimatedStyle(() => ({ transform: [{ translateX: markShift.get() }, { scale: markScale.get() }] }));
  const wordStyle = useAnimatedStyle(() => ({ opacity: wordOpacity.get(), transform: [{ translateX: wordShift.get() }] }));

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: dark ? SPLASH.dark : SPLASH.light }, overlayStyle]}
    >
      <Animated.View style={[styles.row, { opacity: wordWidth === 0 ? 0 : 1 }, contentStyle]}>
        <Animated.View style={markStyle}>
          <Image source={require("../../../assets/splash-icon.png")} style={{ width: MARK, height: MARK }} />
        </Animated.View>
        <Animated.Text
          onLayout={(e) => setWordWidth(e.nativeEvent.layout.width)}
          style={[type.display, styles.word, { color: dark ? SPLASH.light : SPLASH.dark }, wordStyle]}
        >
          {brand.name}
        </Animated.Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center", zIndex: 1000, elevation: 1000 },
  row: { flexDirection: "row", alignItems: "center", gap: GAP },
  word: { fontSize: 44, lineHeight: 52, letterSpacing: -1.2 },
});
