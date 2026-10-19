// Where to put a received file: share sheet (iOS "Save to Files", any Android target), the
// photo library (only for sniffed images/videos), or a folder (Android).
import { FolderDown, Image as ImageIcon, Share2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import type { LocalFile } from "@/lib/files/local-file";
import { canSaveToFolder, canSaveToPhotos, saveToFolder, saveToPhotos } from "@/lib/storage/save";
import { Divider, ListRow } from "@/components/ui/list-row";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { Platform } from "react-native";

export interface SaveSheetProps {
  visible: boolean;
  onClose: () => void;
  file: LocalFile | null;
  name: string;
  /** The transfer manager's save (share sheet), which also tracks "Saved". */
  onShare: () => void;
}

export function SaveSheet({ visible, onClose, file, name, onShare }: SaveSheetProps) {
  const [photos, setPhotos] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (visible && file) void canSaveToPhotos(file).then((ok) => !cancelled && setPhotos(ok));
    return () => {
      cancelled = true;
    };
  }, [visible, file]);

  const run = async (task: () => Promise<"saved" | "cancelled">, done: string) => {
    onClose();
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 250));
    if ((await task()) === "saved") toast.success(done);
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Save file" subtitle={name}>
      <ListRow
        icon={Share2}
        title={Platform.OS === "ios" ? "Save to Files or share" : "Share or open with…"}
        subtitle="Any app on this device"
        onPress={() => {
          onClose();
          setTimeout(onShare, 250);
        }}
      />
      {photos && file ? (
        <>
          <Divider inset={46} />
          <ListRow icon={ImageIcon} title="Save to Photos" subtitle="Adds it to your photo library" onPress={() => void run(() => saveToPhotos(file), "Saved to Photos")} />
        </>
      ) : null}
      {canSaveToFolder && file ? (
        <>
          <Divider inset={46} />
          <ListRow icon={FolderDown} title="Save to a folder" subtitle="Downloads or any folder you choose" onPress={() => void run(() => saveToFolder(file, name), "Saved to folder")} />
        </>
      ) : null}
    </Sheet>
  );
}
