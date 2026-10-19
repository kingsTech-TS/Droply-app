// Shareable result card ("Sent 4.2 GB in 51 s ⚡"): the website draws it on a canvas; here it
// is a normal view rendered off-screen by <ResultCardHost/> and captured as a PNG.
// Only numbers and the product name: no file names.
import { Zap } from "lucide-react-native";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { StyleSheet, View, type ViewInstance } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { captureRef } from "react-native-view-shot";
import { brand } from "@/config/brand";
import { shareCard, type CardContent } from "@/lib/share/result-card";
import { Store } from "@/lib/utils/emitter";
import { logger } from "@/lib/utils/logger";
import { Text } from "@/components/ui/text";

interface Request {
  id: number;
  content: CardContent;
  text: string;
  resolve: (result: "shared" | "cancelled") => void;
}

const queue = new Store<Request | null>(null);
let nextId = 1;

/** Renders the card, captures it and opens the share sheet. */
export function shareResultCard(content: CardContent, text: string): Promise<"shared" | "cancelled"> {
  return new Promise((resolve) => queue.set({ id: nextId++, content, text, resolve }));
}

const WIDTH = 1200;
const HEIGHT = 630;

function Card({ content }: { content: CardContent }) {
  return (
    <LinearGradient colors={["#1b1640", "#0d2a52"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
      {Array.from({ length: 6 }, (_, i) => (
        <View key={i} style={[styles.line, { left: -100 + i * 70 }]} />
      ))}
      <View style={styles.brand}>
        <Zap size={44} color="#ffffff" fill="#ffffff" />
        <Text style={styles.brandText}>{brand.name}</Text>
      </View>
      <Text style={styles.headline} numberOfLines={2}>
        {content.headline}
      </Text>
      <Text style={styles.detail} numberOfLines={1}>
        {content.detail}
      </Text>
      <Text style={styles.footer} numberOfLines={1}>
        {content.footer ?? brand.tagline}
      </Text>
    </LinearGradient>
  );
}

/** Mount once at the root. Invisible; only renders while a card is being captured. */
export function ResultCardHost() {
  const request = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const ref = useRef<ViewInstance>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!request || !ready) return;
    let cancelled = false;
    void (async () => {
      try {
        const uri = await captureRef(ref, { format: "png", quality: 1, result: "tmpfile", width: WIDTH, height: HEIGHT });
        if (cancelled) return;
        request.resolve(await shareCard(uri, request.text));
      } catch (error) {
        logger.warn("share", "capturing the card failed", String(error));
        request.resolve("cancelled");
      } finally {
        queue.set(null);
        setReady(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request, ready]);

  if (!request) return null;
  return (
    <View style={styles.offscreen} pointerEvents="none" importantForAccessibility="no-hide-descendants">
      <View ref={ref} collapsable={false} onLayout={() => setReady(true)}>
        <Card content={request.content} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  offscreen: { position: "absolute", left: -WIDTH * 2, top: 0, opacity: 1 },
  card: { width: WIDTH, height: HEIGHT, padding: 80, overflow: "hidden" },
  line: { position: "absolute", top: -100, width: 6, height: HEIGHT * 1.6, backgroundColor: "rgba(124, 92, 255, 0.25)", transform: [{ rotate: "35deg" }] },
  brand: { flexDirection: "row", alignItems: "center", gap: 14 },
  brandText: { color: "#ffffff", fontSize: 44, lineHeight: 52, fontWeight: "600" },
  headline: { color: "#ffffff", fontSize: 84, lineHeight: 96, fontWeight: "700", marginTop: 90 },
  detail: { color: "#c7c2ff", fontSize: 40, lineHeight: 48, fontWeight: "500", marginTop: 40 },
  footer: { color: "rgba(255,255,255,0.7)", fontSize: 30, lineHeight: 36, position: "absolute", left: 80, bottom: 56 },
});
