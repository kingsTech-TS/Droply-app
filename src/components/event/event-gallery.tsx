import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { Check, Download, Folder, Loader, RotateCw, Save, Users } from "lucide-react-native";
import { FileIcon } from "@/components/transfer/file-icon";
import { Button } from "@/components/ui/button";
import { PressableScale } from "@/components/ui/pressable-scale";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Text } from "@/components/ui/text";
import { toast } from "@/components/ui/toast";
import type { EventRequest } from "@/lib/session/event-share";
import { fileKind } from "@/lib/utils/file-kind";
import { formatBytes } from "@/lib/utils/format";
import type { TransferSnapshot } from "@/lib/webrtc/transfer-manager";
import { aggregateProgress, primaryStatus } from "@/lib/webrtc/transfer-view";
import { useTheme } from "@/theme/theme-provider";
import { radius, space } from "@/theme/tokens";
import type { CatalogItem } from "@/types/room";

/** Shown at a time; "Show more" adds this many (previews are asked for as they show). */
const PAGE = 40;

type GuestState =
  | { kind: "available" }
  | { kind: "waiting" }
  | { kind: "unavailable" }
  | { kind: "downloading"; fraction: number }
  | { kind: "ready"; transfer: TransferSnapshot }
  | { kind: "saved"; transfer: TransferSnapshot }
  | { kind: "failed" };

function guestState(request: EventRequest | undefined, transfer: TransferSnapshot | undefined): GuestState {
  if (!request) return { kind: "available" };
  if (request.unavailable) return { kind: "unavailable" };
  if (!transfer) return { kind: "waiting" };
  const status = primaryStatus(transfer);
  if (status === "completed") return transfer.save === "saved" ? { kind: "saved", transfer } : { kind: "ready", transfer };
  if (status === "failed" || status === "cancelled" || status === "expired" || status === "rejected") return { kind: "failed" };
  if (status === "transferring" || status === "paused") return { kind: "downloading", fraction: aggregateProgress(transfer).fraction };
  return { kind: "waiting" };
}

const isVisual = (item: CatalogItem) => {
  const kind = fileKind(item.name, item.mime_type);
  return kind === "image" || kind === "video";
};

export interface EventGalleryProps {
  items: CatalogItem[];
  hostName: string;
  thumbs: Readonly<Record<string, string>>;
  requests: Readonly<Record<string, EventRequest>>;
  transfers: TransferSnapshot[];
  hostId: string | null;
  onDownload: (itemIds: string[]) => Promise<number>;
  onRequestThumbs: (itemIds: string[]) => void;
  /** A finished file: open the save options. */
  onSave: (transfer: TransferSnapshot) => void;
  people: number;
  disabled?: boolean;
}

/** Event rooms (guest): what the host shares, with previews; pick files or download all. */
export function EventGallery({ items, hostName, thumbs, requests, transfers, hostId, onDownload, onRequestThumbs, onSave, people, disabled }: EventGalleryProps) {
  const { colors } = useTheme();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(false);

  const byBatch = useMemo(() => new Map(transfers.filter((t) => t.direction === "incoming").map((t) => [t.batchId, t])), [transfers]);
  const states = useMemo(() => {
    const out = new Map<string, GuestState>();
    for (const item of items) {
      const request = requests[item.item_id];
      out.set(item.item_id, guestState(request, request ? byBatch.get(`rq_${hostId}_${request.requestId}`) : undefined));
    }
    return out;
  }, [items, requests, byBatch, hostId]);

  const visible = items.slice(0, shown);
  const visibleKey = visible.map((i) => i.item_id).join(",");
  // Ask for previews of the files on screen (the host makes them on demand).
  useEffect(() => {
    const ids = visible.filter(isVisual).map((i) => i.item_id);
    if (ids.length) onRequestThumbs(ids);
    // `visibleKey` stands for the visible items.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey, onRequestThumbs]);

  const downloadable = items.filter((i) => {
    const s = states.get(i.item_id)?.kind;
    return s === "available" || s === "failed" || s === "unavailable";
  });
  const chosen = [...selected].filter((id) => downloadable.some((i) => i.item_id === id));
  const totalSize = items.reduce((sum, i) => sum + i.size, 0);

  const download = async (ids: string[]) => {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const sent = await onDownload(ids);
      if (sent > 0) toast.success(sent === 1 ? "Asked the host for 1 file." : `Asked the host for ${sent} files.`);
      setSelected(new Set());
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <View style={{ gap: space.md }}>
      <View style={{ gap: 2 }}>
        <Text variant="headline">Shared by {hostName}</Text>
        <View style={styles.meta}>
          <Text variant="footnote" tone="muted">
            {items.length} {items.length === 1 ? "file" : "files"}
            {items.length ? ` · ${formatBytes(totalSize)}` : ""}
          </Text>
          <Users size={13} color={colors.mutedForeground} />
          <Text variant="footnote" tone="muted">
            {people} {people === 1 ? "person" : "people"} here
          </Text>
        </View>
      </View>

      {downloadable.length > 0 ? (
        <View style={styles.actions}>
          {chosen.length > 0 ? (
            <>
              <Button label={`Download ${chosen.length}`} icon={Download} size="sm" onPress={() => void download(chosen)} disabled={busy || disabled} />
              <Button label="Clear" size="sm" variant="ghost" onPress={() => setSelected(new Set())} />
            </>
          ) : null}
          <Button
            label={downloadable.length < items.length ? `Download all (${downloadable.length})` : "Download all"}
            icon={Download}
            size="sm"
            variant={chosen.length ? "outline" : "primary"}
            onPress={() => void download(downloadable.map((i) => i.item_id))}
            disabled={busy || disabled}
          />
        </View>
      ) : null}

      {items.length === 0 ? (
        <View style={[styles.empty, { borderColor: colors.border }]}>
          <Text variant="footnote" tone="muted" center>
            Nothing shared yet. Files the host shares appear here: pick the ones you want.
          </Text>
        </View>
      ) : (
        <View style={styles.grid}>
          {visible.map((item) => {
            const state = states.get(item.item_id) ?? { kind: "available" as const };
            const selectable = state.kind === "available" || state.kind === "failed" || state.kind === "unavailable";
            const isSelected = selected.has(item.item_id);
            const thumb = thumbs[item.item_id];
            return (
              <View key={item.item_id} style={[styles.card, { backgroundColor: colors.card, borderColor: isSelected ? colors.primary : colors.border, borderWidth: isSelected ? 2 : StyleSheet.hairlineWidth }]}>
                <PressableScale
                  onPress={selectable ? () => toggle(item.item_id) : undefined}
                  disabled={!selectable}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isSelected, disabled: !selectable }}
                  accessibilityLabel={item.name}
                  style={[styles.preview, { backgroundColor: colors.muted }]}
                >
                  {thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} /> : <FileIcon name={item.name} mimeType={item.mime_type} size={48} />}
                  {selectable ? (
                    <View style={[styles.check, { borderColor: isSelected ? colors.primary : colors.border, backgroundColor: isSelected ? colors.primary : colors.card }]}>
                      {isSelected ? <Check size={14} color={colors.primaryForeground} strokeWidth={3} /> : null}
                    </View>
                  ) : null}
                </PressableScale>
                <View style={styles.body}>
                  <Text variant="footnote" numberOfLines={1} style={{ fontWeight: "600" }}>
                    {item.name}
                  </Text>
                  <View style={styles.meta}>
                    {item.folder ? <Folder size={11} color={colors.mutedForeground} /> : null}
                    <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                      {item.folder ? `${item.folder} · ` : ""}
                      {formatBytes(item.size)}
                    </Text>
                  </View>
                  <GuestAction state={state} disabled={disabled} name={item.name} onDownload={() => void download([item.item_id])} onSave={onSave} />
                </View>
              </View>
            );
          })}
        </View>
      )}
      {items.length > shown ? <Button label={`Show more (${items.length - shown})`} variant="outline" onPress={() => setShown((n) => n + PAGE)} /> : null}
    </View>
  );
}

function GuestAction({ state, disabled, name, onDownload, onSave }: { state: GuestState; disabled?: boolean; name: string; onDownload: () => void; onSave: (t: TransferSnapshot) => void }) {
  const { colors } = useTheme();
  switch (state.kind) {
    case "available":
      return <Button label="Download" icon={Download} size="sm" variant="tinted" fullWidth onPress={onDownload} disabled={disabled} accessibilityLabel={`Download ${name}`} />;
    case "waiting":
      return (
        <View style={styles.status}>
          <Loader size={14} color={colors.mutedForeground} />
          <Text variant="caption" tone="muted">
            Waiting for the host…
          </Text>
        </View>
      );
    case "downloading":
      return (
        <View style={{ gap: space.xs }}>
          <ProgressBar value={state.fraction} active height={6} accessibilityLabel={`Downloading ${name}`} />
          <Text variant="caption" tone="muted">
            {Math.round(state.fraction * 100)}%
          </Text>
        </View>
      );
    case "ready":
      return <Button label="Save" icon={Save} size="sm" fullWidth onPress={() => onSave(state.transfer)} accessibilityLabel={`Save ${name}`} />;
    case "saved":
      return (
        <View style={styles.status}>
          <Check size={14} color={colors.success} />
          <Text variant="caption" tone="success">
            Saved
          </Text>
        </View>
      );
    case "failed":
    case "unavailable":
      return (
        <Button
          label={state.kind === "unavailable" ? "Unavailable · retry" : "Try again"}
          icon={RotateCw}
          size="sm"
          variant="outline"
          fullWidth
          onPress={onDownload}
          disabled={disabled}
          accessibilityLabel={`Try ${name} again`}
        />
      );
  }
}

const styles = StyleSheet.create({
  meta: { flexDirection: "row", alignItems: "center", gap: space.xs, flexWrap: "wrap" },
  actions: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  empty: { borderWidth: 1, borderStyle: "dashed", borderRadius: radius.xl, padding: space.xl },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  card: { width: "47.5%", flexGrow: 1, maxWidth: "50%", borderRadius: radius.lg, overflow: "hidden" },
  preview: { aspectRatio: 1, width: "100%", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  check: { position: "absolute", top: space.sm, left: space.sm, width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  body: { padding: space.sm, gap: space.xs },
  status: { flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: 38 },
});
