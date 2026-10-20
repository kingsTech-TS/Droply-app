// Timed rooms (website: room-time.tsx): the host's room length and the one-time "Add time".
import { Hourglass, Lock, Timer } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { userMessage } from "@/lib/api/errors";
import { addTimeBlocked, type RoomTimeInfo } from "@/lib/rooms/time";
import { useTheme } from "@/theme/theme-provider";
import { space } from "@/theme/tokens";
import { ROOM_MAX_MINUTES } from "@/types/room";
import { MinutePicker } from "@/components/home/duration-picker";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Banner } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { toast } from "@/components/ui/toast";

export { addTimeBlocked, type RoomTimeInfo };

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Host-only: the room's length, and the one-time "Add time". */
export function RoomTimeSettings({ info, onAddTime }: { info: RoomTimeInfo; onAddTime: () => void }) {
  const { colors } = useTheme();
  if (info.durationSeconds === null) return null;
  const minutes = Math.round(info.durationSeconds / 60);
  const blocked = addTimeBlocked(info);
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
        <Timer size={16} color={colors.primary} />
        <Text variant="bodyStrong">
          Room time: <Text variant="bodyStrong" tone="primary">{minutes} min</Text>
        </Text>
      </View>
      <Text variant="footnote" tone="muted">
        {info.createdAt !== null ? `Ends at ${clock(info.createdAt + info.durationSeconds * 1000)}. ` : null}
        {blocked ?? `You can add time once, up to ${ROOM_MAX_MINUTES} minutes in total.`}
      </Text>
      <Button label="Add time" icon={blocked ? Lock : Hourglass} size="sm" variant="outline" onPress={onAddTime} disabled={blocked !== null} style={{ alignSelf: "flex-start" }} />
    </View>
  );
}

/** Pick the room's new total length. Allowed once, so the button says exactly what happens. */
export function AddTimeSheet({
  visible,
  onClose,
  info,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  info: RoomTimeInfo;
  onConfirm: (minutes: number) => Promise<void>;
}) {
  const current = Math.round((info.durationSeconds ?? 0) / 60);
  const min = Math.min(current + 1, ROOM_MAX_MINUTES);
  const [picked, setPicked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const value = Math.min(Math.max(picked ?? ROOM_MAX_MINUTES, min), ROOM_MAX_MINUTES);
  const options = [...new Set([current + 1, current + 2, current + 5, current + 10, ROOM_MAX_MINUTES])]
    .filter((m) => m > current && m <= ROOM_MAX_MINUTES)
    .sort((a, b) => a - b);
  const blocked = addTimeBlocked(info);

  const close = () => {
    setPicked(null);
    onClose();
  };
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm(value);
      toast.success(`The room now lasts ${value} minutes.`);
      close();
    } catch (error) {
      toast.error(userMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={close}
      icon={Hourglass}
      title="Add time to the room"
      subtitle={`The room has ${current} minutes. Pick a new total of up to ${ROOM_MAX_MINUTES} minutes. You can only do this once.`}
      footer={<Button label={`Set to ${value} minutes`} size="lg" onPress={() => void confirm()} disabled={busy || blocked !== null} loading={busy} fullWidth />}
    >
      {blocked ? (
        <Banner tone="warning" icon={Lock}>
          {blocked}
        </Banner>
      ) : (
        <>
          <MinutePicker
            value={value}
            onChange={setPicked}
            min={min}
            max={ROOM_MAX_MINUTES}
            presets={options}
            label="New room time in minutes"
            formatPreset={(m) => `${m} min (+${m - current})`}
          />
          <Text variant="footnote" tone="muted">
            New time: <Text variant="footnote" style={{ fontWeight: "700" }}>{value} min</Text>
            {info.createdAt !== null ? ` · ends at ${clock(info.createdAt + value * 60_000)}` : ""}
          </Text>
        </>
      )}
    </Sheet>
  );
}
