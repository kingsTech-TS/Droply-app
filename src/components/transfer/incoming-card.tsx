// "Incoming files" (website: incoming-transfer.tsx): who, how many, total, a storage check,
// "Auto-accept from X in this room", Decline / Save to folder… (Android) / Accept.
import { Download, FolderDown, TriangleAlert } from "lucide-react-native";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Platform, StyleSheet, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp, LinearTransition } from "react-native-reanimated";
import { useLocalStore } from "@/hooks/use-local-store";
import { preferences } from "@/lib/fun/prefs";
import { chooseDroplyFolder, droplyFolder, refreshDroplyFolder } from "@/lib/storage/droply-folder";
import { canSaveDirectlyToDisk, pickDirectory, type DirectoryHandleLike } from "@/lib/storage/sinks/fs-access-sink";
import { formatBytes } from "@/lib/utils/format";
import type { IncomingRequest, TransferSnapshot } from "@/lib/webrtc/transfer-manager";
import { useTheme } from "@/theme/theme-provider";
import { elevation, radius, space } from "@/theme/tokens";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Banner } from "@/components/ui/states";
import { SwitchRow } from "@/components/ui/switch-row";
import { Text } from "@/components/ui/text";
import { FileIcon } from "./file-icon";

const VISIBLE = 6;

export interface IncomingCardProps {
  request: IncomingRequest;
  senderName: string;
  files: TransferSnapshot[];
  checkStorage: () => Promise<boolean | null>;
  onAccept: (options: { directory?: DirectoryHandleLike | null; trust: boolean }) => void;
  onDecline: () => void;
}

export function IncomingCard({ request, senderName, files, checkStorage, onAccept, onDecline }: IncomingCardProps) {
  const { colors } = useTheme();
  const [trust, setTrust] = useState(false);
  const [fits, setFits] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const folderPossible = canSaveDirectlyToDisk();

  useEffect(() => {
    let cancelled = false;
    void checkStorage().then((result) => {
      if (!cancelled) setFits(result);
    });
    return () => {
      cancelled = true;
    };
  }, [checkStorage, request.totalBytes]);
  const tooBig = fits === false;

  const { autoSave } = useLocalStore(preferences);
  const folder = useSyncExternalStore(droplyFolder.subscribe, droplyFolder.getSnapshot, droplyFolder.getSnapshot);
  useEffect(() => {
    refreshDroplyFolder();
  }, []);

  const accept = async () => {
    setBusy(true);
    // Android: the first time, choose where the Droply folder goes (from this tap).
    if (autoSave && Platform.OS === "android" && folder.status === "unset") await chooseDroplyFolder();
    onAccept({ trust });
  };

  const saveNote = !autoSave
    ? null
    : folder.status === "ready"
      ? `Saves to ${folder.label} automatically.`
      : "Saves automatically to a Droply folder: you'll choose where it goes this once.";

  const acceptToFolder = async () => {
    const directory = await pickDirectory();
    if (!directory) return;
    setBusy(true);
    onAccept({ directory, trust });
  };

  return (
    <Animated.View entering={FadeInUp.springify().damping(15)} exiting={FadeOutUp.duration(200)} layout={LinearTransition.springify()}>
      <Card style={[{ gap: space.md, borderColor: colors.primary, borderWidth: 1.5 }, elevation(2, colors)]} accessibilityRole="alert">
        <View style={styles.header}>
          <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
            <Download size={20} color={colors.primary} strokeWidth={2.4} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="subhead">Incoming files</Text>
            <Text variant="footnote" tone="muted">
              <Text variant="footnote" style={{ fontWeight: "700" }}>
                {senderName}
              </Text>{" "}
              wants to send you {files.length === 1 ? "a file" : `${files.length} files`}
            </Text>
          </View>
        </View>
        <View style={{ gap: space.sm }}>
          {files.slice(0, VISIBLE).map((file) => (
            <View key={file.localId} style={styles.file}>
              <FileIcon name={file.fileName} mimeType={file.mimeType} size={34} />
              <Text variant="callout" numberOfLines={1} style={{ flex: 1 }}>
                {file.fileName}
              </Text>
              <Text variant="footnote" tone="muted">
                {formatBytes(file.fileSize)}
              </Text>
            </View>
          ))}
          {files.length > VISIBLE ? (
            <Text variant="footnote" tone="muted">
              and {files.length - VISIBLE} more
            </Text>
          ) : null}
          <Text variant="footnote" style={{ fontWeight: "600" }}>
            Total: {formatBytes(request.totalBytes)}
          </Text>
        </View>
        {tooBig ? (
          <Banner tone="warning" icon={TriangleAlert}>
            {folderPossible ? "There may not be enough free space for this. Choose a folder to save the files to." : "There may not be enough storage on this device for these files."}
          </Banner>
        ) : null}
        <SwitchRow label={`Auto-accept from ${senderName} in this room`} value={trust} onChange={setTrust} />
        <View style={styles.actions}>
          <Button label="Decline" variant="outline" onPress={onDecline} disabled={busy} style={{ flex: 1 }} />
          {folderPossible ? <Button label="Save to folder…" icon={FolderDown} variant={tooBig ? "primary" : "secondary"} onPress={() => void acceptToFolder()} disabled={busy} style={{ flex: 1.3 }} /> : null}
          {!tooBig || !folderPossible ? (
            <Button label="Accept" onPress={() => void accept()} disabled={busy} style={{ flex: 1 }} />
          ) : null}
        </View>
        {saveNote ? (
          <Text variant="caption" tone="muted" style={{ textAlign: "right" }}>
            {saveNote}
          </Text>
        ) : null}
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: space.md },
  icon: { width: 42, height: 42, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  file: { flexDirection: "row", alignItems: "center", gap: space.md },
  actions: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
});
