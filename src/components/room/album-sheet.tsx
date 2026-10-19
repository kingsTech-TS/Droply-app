// Room album (website: album-dialog.tsx) + a full-screen media viewer. Only files whose
// first bytes are a real image or video appear. "Add photos for everyone" sends to every
// device in the room.
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { Download, ImagePlus, Images, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Modal, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { LocalFile } from "@/lib/files/local-file";
import { sniffMedia, type MediaKind } from "@/lib/media/sniff";
import { space } from "@/theme/tokens";
import { MediaThumb } from "@/components/transfer/media-thumb";
import { pickFrom } from "@/components/transfer/add-files-sheet";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Sheet } from "@/components/ui/sheet";
import { EmptyState } from "@/components/ui/states";
import { Text } from "@/components/ui/text";

export interface AlbumItem {
  localId: string;
  direction: "outgoing" | "incoming";
  name: string;
  file: LocalFile;
  peerId: string;
}

function VideoPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  return <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls contentFit="contain" />;
}

export function MediaViewer({ file, name, onClose, onSave }: { file: LocalFile | null; name: string; onClose: () => void; onSave?: () => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [sniffed, setSniffed] = useState<{ uri: string; media: MediaKind | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (file) void sniffMedia(file).then((m) => !cancelled && setSniffed({ uri: file.uri, media: m }));
    return () => {
      cancelled = true;
    };
  }, [file]);
  const media = file && sniffed?.uri === file.uri ? sniffed.media : null;
  return (
    <Modal visible={file !== null} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.viewer}>
        {file && media?.kind === "image" ? (
          <Animated.View entering={ZoomIn.duration(220)} style={StyleSheet.absoluteFill}>
            <Image source={{ uri: file.uri }} style={StyleSheet.absoluteFill} contentFit="contain" />
          </Animated.View>
        ) : null}
        {file && media?.kind === "video" ? <VideoPlayer uri={file.uri} /> : null}
        <View style={[styles.viewerBar, { paddingTop: insets.top + space.sm, width }]}>
          <IconButton icon={X} label="Close" color="#ffffff" onPress={onClose} style={styles.viewerButton} />
          <Text color="#ffffff" variant="callout" numberOfLines={1} style={{ flex: 1, marginHorizontal: space.sm }}>
            {name}
          </Text>
          {onSave ? <IconButton icon={Download} label="Save" color="#ffffff" onPress={onSave} style={styles.viewerButton} /> : null}
        </View>
      </View>
    </Modal>
  );
}

export interface AlbumSheetProps {
  visible: boolean;
  onClose: () => void;
  candidates: AlbumItem[];
  deviceName: (id: string) => string;
  onAddPhotos: (files: LocalFile[]) => void;
  onSave: (item: AlbumItem) => void;
  onSaveAll: () => void;
}

export function AlbumSheet({ visible, onClose, candidates, deviceName, onAddPhotos, onSave, onSaveAll }: AlbumSheetProps) {
  const { width } = useWindowDimensions();
  const [media, setMedia] = useState<AlbumItem[]>([]);
  const [viewing, setViewing] = useState<AlbumItem | null>(null);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void Promise.all(candidates.map(async (c) => ((await sniffMedia(c.file)) ? c : null))).then((list) => {
      if (!cancelled) setMedia(list.filter((c): c is AlbumItem => c !== null));
    });
    return () => {
      cancelled = true;
    };
  }, [visible, candidates]);
  const received = media.filter((m) => m.direction === "incoming").length;
  const tile = Math.floor((Math.min(width, 640) - space.xl * 2 - space.sm * 2) / 3);

  return (
    <>
      <Sheet visible={visible} onClose={onClose} icon={Images} title="Room album" subtitle="Photos and videos shared in this room. Adding photos sends them to everyone here.">
        <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
          <Button
            label="Add photos for everyone"
            icon={ImagePlus}
            size="sm"
            variant="secondary"
            onPress={() =>
              void pickFrom("media").then((files) => {
                if (files.length) onAddPhotos(files);
              })
            }
          />
          {received >= 2 ? <Button label="Save all received" size="sm" variant="outline" onPress={onSaveAll} /> : null}
        </View>
        {media.length === 0 ? (
          <EmptyState icon={Images} title="No photos or videos yet." />
        ) : (
          <View style={styles.grid}>
            {media.map((item) => (
              <Animated.View key={`${item.direction}:${item.localId}`} entering={FadeIn} style={{ width: tile, gap: 4 }}>
                <MediaThumb file={item.file} name={item.name} size={tile} onOpen={() => setViewing(item)} />
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {item.direction === "outgoing" ? "You" : deviceName(item.peerId)}
                </Text>
              </Animated.View>
            ))}
          </View>
        )}
      </Sheet>
      <MediaViewer
        file={viewing?.file ?? null}
        name={viewing?.name ?? ""}
        onClose={() => setViewing(null)}
        onSave={viewing?.direction === "incoming" ? () => viewing && onSave(viewing) : undefined}
      />
    </>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  viewer: { flex: 1, backgroundColor: "#000000" },
  viewerBar: { position: "absolute", top: 0, flexDirection: "row", alignItems: "center", paddingHorizontal: space.sm, paddingBottom: space.sm, backgroundColor: "rgba(0,0,0,0.35)" },
  viewerButton: { backgroundColor: "rgba(255,255,255,0.12)" },
});
