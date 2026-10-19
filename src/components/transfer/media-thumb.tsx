// Preview of a photo/video — only when the file's first bytes prove it's a raster image or
// a video (never trusted from the name or MIME type), and within the device's memory budget.
import { Image } from "expo-image";
import { Play } from "lucide-react-native";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import type { LocalFile } from "@/lib/files/local-file";
import { sniffMedia, type MediaKind } from "@/lib/media/sniff";
import { thumbnailUrl } from "@/lib/media/thumbnail";
import { radius } from "@/theme/tokens";
import { PressableScale } from "@/components/ui/pressable-scale";

export interface MediaPreview {
  uri: string;
  kind: MediaKind["kind"];
}

export function useMediaPreview(file: LocalFile | null | undefined): MediaPreview | null {
  // Results are keyed by file, so a stale preview is never shown for a new file.
  const [result, setResult] = useState<{ uri: string; preview: MediaPreview } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!file) return;
    void (async () => {
      const media = await sniffMedia(file);
      if (!media) return;
      const uri = await thumbnailUrl(file);
      if (!cancelled && uri) setResult({ uri: file.uri, preview: { uri, kind: media.kind } });
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);
  return file && result?.uri === file.uri ? result.preview : null;
}

export function MediaThumb({ file, name, size = 44, onOpen }: { file: LocalFile; name: string; size?: number; onOpen?: () => void }) {
  const preview = useMediaPreview(file);
  if (!preview) return null;
  return (
    <PressableScale onPress={onOpen} disabled={!onOpen} accessibilityLabel={`Open preview of ${name}`} scaleTo={0.92}>
      <Animated.View entering={FadeIn.duration(250)} style={{ width: size, height: size, borderRadius: radius.md, overflow: "hidden" }}>
        <Image source={{ uri: preview.uri }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={file.uri} transition={150} />
        {preview.kind === "video" ? (
          <View style={styles.play}>
            <Play size={size * 0.32} color="#ffffff" fill="#ffffff" />
          </View>
        ) : null}
      </Animated.View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  play: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.25)" },
});
