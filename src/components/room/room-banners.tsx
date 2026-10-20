// Connection, expiry and "keep the app open" banners (website: connection-banner.tsx,
// room-banners.tsx).
import { CloudOff, Hourglass, LoaderCircle, Smartphone, Timer, TimerOff, WifiOff } from "lucide-react-native";
import { View } from "react-native";
import { useTheme } from "@/theme/theme-provider";
import { radius, space } from "@/theme/tokens";
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

/**
 * Under the QR code. Timed rooms end at a fixed time (the host may add time once); other
 * rooms have a sliding expiry the server extends while devices are active.
 */
export function RoomCountdown({ expiresAt, wrappingUp = false }: { expiresAt: number | null; wrappingUp?: boolean }) {
  const remaining = useCountdown(expiresAt);
  if (remaining === null) return null;
  return (
    <Text variant="footnote" tone={wrappingUp || remaining < SOON_MS ? "warning" : "muted"} center accessibilityLiveRegion="none">
      {wrappingUp ? "Time's up · finishing transfers" : remaining === 0 ? "Time's up" : `Room ends in ${formatCountdown(remaining)}`}
    </Text>
  );
}

/** Always-visible room timer for the room header (timed rooms). */
export function HeaderTimer({ expiresAt, wrappingUp }: { expiresAt: number; wrappingUp: boolean }) {
  const { colors } = useTheme();
  const remaining = useCountdown(expiresAt);
  if (remaining === null) return null;
  const up = wrappingUp || remaining === 0;
  const soon = up || remaining < SOON_MS;
  const label = up ? "Time's up" : formatCountdown(remaining);
  return (
    <View
      accessible
      accessibilityRole="timer"
      accessibilityLabel={up ? "Room time is up" : `Room ends in ${label}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: space.sm,
        paddingVertical: 3,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: soon ? colors.warning : colors.border,
        backgroundColor: soon ? colors.warningSoft : colors.muted,
      }}
    >
      <Timer size={12} color={soon ? colors.warning : colors.foreground} />
      <Text variant="caption" color={soon ? colors.warning : colors.foreground} style={{ fontVariant: ["tabular-nums"], fontWeight: "700" }}>
        {label}
      </Text>
    </View>
  );
}

/**
 * A timed room is about to end. The host can add time if they haven't yet; everyone else
 * just gets the heads-up.
 */
export function TimedRoomEndingPrompt({
  expiresAt,
  timeUp,
  onAddTime,
  lockedReason,
}: {
  expiresAt: number | null;
  timeUp: boolean;
  /** Host only, while time can still be added. */
  onAddTime?: () => void;
  /** Shown to the host when time can't be added any more. */
  lockedReason?: string | null;
}) {
  const remaining = useCountdown(expiresAt);
  if (timeUp || remaining === null || remaining === 0 || remaining > SOON_MS) return null;
  return (
    <Banner tone="warning" icon={Timer} action={onAddTime ? <Button label="Add time" icon={Hourglass} size="sm" variant="outline" onPress={onAddTime} /> : undefined}>
      <Text variant="footnote" style={{ fontWeight: "600" }}>
        This room ends in <Text variant="mono" style={{ fontSize: 13 }}>{formatCountdown(remaining)}</Text>.{" "}
        {onAddTime ? null : lockedReason ? lockedReason : "Files still on their way when time runs out will finish."}
      </Text>
    </Banner>
  );
}

/** Time is up: running transfers finish, nothing new can be sent, then the room closes. */
export function TimeUpBanner({ show, transfersRunning }: { show: boolean; transfersRunning: boolean }) {
  if (!show) return null;
  return (
    <Banner tone="error" icon={TimerOff}>
      <View style={{ gap: 2 }}>
        <Text variant="footnote" style={{ fontWeight: "700" }}>
          Time&apos;s up for this room.
        </Text>
        <Text variant="footnote" tone="muted">
          {transfersRunning
            ? "Files already on their way will finish, then the room closes. Nothing new can be sent."
            : "The room is closing. Nothing new can be sent."}
        </Text>
      </View>
    </Banner>
  );
}
