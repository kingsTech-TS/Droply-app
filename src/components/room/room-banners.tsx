// Connection, expiry and "keep the app open" banners (website: connection-banner.tsx,
// room-banners.tsx).
import { CloudOff, FolderDown, LoaderCircle, Smartphone, Timer, WifiOff } from "lucide-react-native";
import type { RoomSnapshot } from "@/lib/session/room-session";
import { formatCountdown } from "@/lib/utils/format";
import { useCountdown } from "@/hooks/use-countdown";
import { Button } from "@/components/ui/button";
import { Banner } from "@/components/ui/states";
import { Text } from "@/components/ui/text";

/** Shown only when the control connection to the server is not healthy. */
export function ConnectionBanner({ room, onRetry }: { room: RoomSnapshot; onRetry: () => void }) {
  if (!room.online) {
    return (
      <Banner tone="warning" icon={WifiOff}>
        Connection interrupted. You&apos;re offline; transfers will resume when you&apos;re back.
      </Banner>
    );
  }
  if (room.endReason === "gave_up") {
    return (
      <Banner tone="error" icon={CloudOff} action={<Button label="Retry" size="sm" variant="outline" onPress={onRetry} />}>
        Can&apos;t reach the server.
      </Banner>
    );
  }
  if (room.status === "reconnecting") {
    return (
      <Banner tone="info" icon={LoaderCircle}>
        Connection interrupted. Reconnecting…
      </Banner>
    );
  }
  if (room.status === "connecting") {
    return (
      <Banner tone="info" icon={LoaderCircle}>
        Connecting to the room…
      </Banner>
    );
  }
  return null;
}

/** The OS suspends apps in the background, which stops WebRTC (website: "keep this tab open"). */
export function KeepAppOpenBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <Banner tone="info" icon={Smartphone}>
      Keep Droply open until the transfer finishes. If it&apos;s interrupted, it continues from where it stopped.
    </Banner>
  );
}

/** Android, once: where the Droply folder goes (saving waits until it's chosen). */
export function SaveFolderBanner({ onChoose }: { onChoose: () => void }) {
  return (
    <Banner tone="info" icon={FolderDown} action={<Button label="Choose folder" size="sm" onPress={onChoose} />}>
      <Text variant="footnote" style={{ fontWeight: "600" }}>
        Choose where Droply saves received files. It makes a Droply folder there (Download works well).
      </Text>
    </Banner>
  );
}

const SOON_MS = 2 * 60 * 1000;

/** Offered when an idle room is about to expire. */
export function ExpiryPrompt({ expiresAt, onKeepOpen }: { expiresAt: number | null; onKeepOpen: () => void }) {
  const remaining = useCountdown(expiresAt);
  if (remaining === null || remaining === 0 || remaining > SOON_MS) return null;
  return (
    <Banner tone="warning" icon={Timer} action={<Button label="Keep open" size="sm" variant="outline" onPress={onKeepOpen} />}>
      <Text variant="footnote" style={{ fontWeight: "600" }}>
        This room expires in <Text variant="mono" style={{ fontSize: 13 }}>{formatCountdown(remaining)}</Text>. Keep it open?
      </Text>
    </Banner>
  );
}
