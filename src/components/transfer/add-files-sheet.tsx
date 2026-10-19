// Where to pick files from (the website's drop zone / file input / folder button).
import { ClipboardPaste, FolderDown, FolderOpen, Images } from "lucide-react-native";
import { useState } from "react";
import { canPickFolder, pickDocuments, pickFolder, pickMedia } from "@/lib/files/pick";
import type { LocalFile } from "@/lib/files/local-file";
import { logger } from "@/lib/utils/logger";
import { Divider, ListRow } from "@/components/ui/list-row";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";

export type FileSource = "files" | "media" | "folder";

export async function pickFrom(source: FileSource): Promise<LocalFile[]> {
  try {
    if (source === "files") return await pickDocuments();
    if (source === "media") return await pickMedia();
    return await pickFolder();
  } catch (error) {
    logger.warn("pick", "picker failed", String(error));
    toast.error("Couldn't open the picker. Please try again.");
    return [];
  }
}

export interface AddFilesSheetProps {
  visible: boolean;
  onClose: () => void;
  onFiles: (files: LocalFile[]) => void;
  title?: string;
  /** In a room: also offer "Paste text" (opens the text drop). */
  onPasteText?: () => void;
}

export function AddFilesSheet({ visible, onClose, onFiles, title = "Add files", onPasteText }: AddFilesSheetProps) {
  const [busy, setBusy] = useState(false);
  const choose = async (source: FileSource) => {
    if (busy) return;
    setBusy(true);
    onClose();
    // Let the sheet close before the system picker slides in.
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 250));
    const files = await pickFrom(source);
    setBusy(false);
    if (files.length > 0) onFiles(files);
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={title} subtitle="Any type, any size. Nothing is uploaded.">
      <ListRow icon={Images} title="Photos & videos" subtitle="From your photo library, original quality" onPress={() => void choose("media")} />
      <Divider inset={46} />
      <ListRow icon={FolderOpen} title="Files" subtitle="Documents, archives, audio, anything" onPress={() => void choose("files")} />
      {canPickFolder ? (
        <>
          <Divider inset={46} />
          <ListRow icon={FolderDown} title="A whole folder" subtitle="Keeps the folder structure" onPress={() => void choose("folder")} />
        </>
      ) : null}
      {onPasteText ? (
        <>
          <Divider inset={46} />
          <ListRow
            icon={ClipboardPaste}
            title="Text or a link"
            subtitle="Sent privately over the encrypted connection"
            onPress={() => {
              onClose();
              onPasteText();
            }}
          />
        </>
      ) : null}
    </Sheet>
  );
}
