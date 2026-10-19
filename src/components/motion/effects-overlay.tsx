// Full-screen effects drawn above everything: confetti bursts (the website's canvas
// confetti, same physics and theme colors) and the file "flight path" between two views
// registered with useFlightAnchor. Both run entirely on the UI thread.
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View, useWindowDimensions, type ViewInstance } from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSequence, withTiming, type SharedValue } from "react-native-reanimated";
import { effects, type ConfettiBurst, type FlightPath } from "@/lib/fun/celebrate";
import { Text } from "@/components/ui/text";

// --- flight anchors ---------------------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const anchors = new Map<string, () => Promise<Rect | null>>();

/** Registers a view as a flight-path endpoint (a device card, the transfer list header). */
export function useFlightAnchor(key: string | null) {
  const ref = useRef<ViewInstance>(null);
  useEffect(() => {
    if (!key) return;
    const measure = () =>
      new Promise<Rect | null>((resolve) => {
        const node = ref.current;
        if (!node) return resolve(null);
        node.measureInWindow((x: number, y: number, width: number, height: number) => resolve(width > 0 ? { x, y, width, height } : null));
      });
    anchors.set(key, measure);
    return () => {
      if (anchors.get(key) === measure) anchors.delete(key);
    };
  }, [key]);
  return ref;
}

// --- confetti -----------------------------------------------------------------------------

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  spin: number;
  color: string;
}

const FRAME_MS = 1000 / 60;

function ConfettiPiece({ p, t, duration }: { p: Particle; t: SharedValue<number>; duration: number }) {
  const style = useAnimatedStyle(() => {
    // Closed form of the website's per-frame update: vy += 0.45, vx *= 0.99.
    const n = t.value / FRAME_MS;
    const x = p.x + (p.vx * (1 - Math.pow(0.99, n))) / 0.01;
    const y = p.y + p.vy * n + (0.45 * n * (n + 1)) / 2;
    return {
      opacity: Math.max(0, 1 - t.value / duration),
      transform: [{ translateX: x }, { translateY: y }, { rotate: `${p.rotation + p.spin * n}rad` }],
    };
  });
  return <Animated.View style={[styles.piece, { width: p.size, height: p.size / 2, backgroundColor: p.color }, style]} />;
}

function Confetti({ burst, onDone }: { burst: ConfettiBurst; onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const duration = burst.intensity === "big" ? 2200 : 1600;
  const [particles] = useState<Particle[]>(() => {
    // Fewer pieces than the browser canvas: each is a native view.
    const count = burst.intensity === "big" ? 90 : 50;
    return Array.from({ length: count }, () => ({
      x: width * (0.3 + Math.random() * 0.4),
      y: height * 0.35,
      vx: (Math.random() - 0.5) * 18,
      vy: -Math.random() * 16 - 6,
      size: 6 + Math.random() * 6,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      color: burst.colors[Math.floor(Math.random() * burst.colors.length)] ?? "#7c5cff",
    }));
  });
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(duration, { duration, easing: Easing.linear }, (finished) => {
      if (finished) runOnJS(onDone)();
    });
  }, [duration, onDone, t]);
  return (
    <>
      {particles.map((p, i) => (
        <ConfettiPiece key={i} p={p} t={t} duration={duration} />
      ))}
    </>
  );
}

// --- flight path ----------------------------------------------------------------------------

function Flight({ from, to, onDone }: { from: Rect; to: Rect; onDone: () => void }) {
  const x0 = from.x + from.width / 2 - 14;
  const y0 = from.y + Math.min(from.height / 2, 24) - 14;
  const x1 = to.x + to.width / 2 - 14;
  const y1 = to.y + Math.min(to.height / 2, 32) - 14;
  const lift = Math.min(160, Math.hypot(x1 - x0, y1 - y0) / 3);
  const xm = (x0 + x1) / 2;
  const ym = Math.min(y0, y1) - lift;
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withTiming(1, { duration: 900, easing: Easing.bezier(0.45, 0.05, 0.35, 1) }, (finished) => {
      if (finished) runOnJS(onDone)();
    });
  }, [onDone, t]);
  const style = useAnimatedStyle(() => {
    const k = t.value;
    // Quadratic Bézier through the lifted midpoint (a gentle arc, like the website).
    const x = (1 - k) * (1 - k) * x0 + 2 * (1 - k) * k * xm + k * k * x1;
    const y = (1 - k) * (1 - k) * y0 + 2 * (1 - k) * k * ym + k * k * y1;
    const scale = k < 0.1 ? 0.6 + 4 * k : k < 0.5 ? 1 + 0.375 * (k - 0.1) : 1.15 - 1.3 * (k - 0.5);
    const opacity = k < 0.1 ? k * 10 : k > 0.85 ? (1 - k) / 0.15 : 1;
    return { opacity, transform: [{ translateX: x }, { translateY: y }, { scale }, { rotate: `${-10 + 18 * Math.min(1, k * 2)}deg` }] };
  });
  return (
    <Animated.View style={[styles.flight, style]}>
      <Text style={{ fontSize: 28, lineHeight: 32 }}>📄</Text>
    </Animated.View>
  );
}

// --- overlay -------------------------------------------------------------------------------

export function EffectsOverlay() {
  const [bursts, setBursts] = useState<ConfettiBurst[]>([]);
  const [flights, setFlights] = useState<Array<{ id: number; from: Rect; to: Rect }>>([]);
  const { height } = useWindowDimensions();
  const flash = useSharedValue(0);

  useEffect(() => {
    const offConfetti = effects.on("confetti", (burst) => {
      setBursts((list) => [...list.slice(-2), burst]);
      flash.value = withSequence(withTiming(0.06, { duration: 80 }), withTiming(0, { duration: 400 }));
    });
    const offFly = effects.on("fly", async (path: FlightPath) => {
      const [from, to] = await Promise.all([anchors.get(path.from)?.(), anchors.get(path.to)?.()]);
      const visible = (r: Rect | null | undefined): r is Rect => !!r && r.y + r.height > 0 && r.y < height;
      if (!visible(from) || !visible(to)) return;
      setFlights((list) => [...list.slice(-5), { id: path.id, from, to }]);
    });
    return () => {
      offConfetti();
      offFly();
    };
  }, [flash, height]);

  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessible={false} importantForAccessibility="no-hide-descendants">
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "#ffffff" }, flashStyle]} />
      {flights.map((f) => (
        <Flight key={f.id} from={f.from} to={f.to} onDone={() => setFlights((list) => list.filter((x) => x.id !== f.id))} />
      ))}
      {bursts.map((b) => (
        <Confetti key={b.id} burst={b} onDone={() => setBursts((list) => list.filter((x) => x.id !== b.id))} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  piece: { position: "absolute", left: 0, top: 0, borderRadius: 1 },
  flight: { position: "absolute", left: 0, top: 0 },
});
