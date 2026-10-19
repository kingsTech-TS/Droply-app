// What the website's room page does in hooks (useCelebrations, useBackgroundNotifications,
// notices → toasts, wake lock) — mounted at the app root so it keeps working while the user
// is on another tab and the room session is still running.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { brand } from "@/config/brand";
import { confetti, flyFile, playSound, vibrate } from "@/lib/fun/celebrate";
import { notifyInBackground } from "@/lib/notifications/notifications";
import type { Celebration, RoomSession } from "@/lib/session/room-session";
import { activeSession } from "@/lib/session/registry";
import { formatBytes, formatDuration, formatSpeed } from "@/lib/utils/format";
import type { Notice } from "@/lib/webrtc/transfer-manager";
import { isActive } from "@/lib/webrtc/transfer-view";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { shareResultCard } from "@/components/share/result-card";
import { toast } from "@/components/ui/toast";

export const TRANSFERS_ANCHOR = "transfers-list";
export const deviceAnchor = (deviceId: string) => `device:${deviceId}`;

function showNotice(notice: Notice): void {
  if (notice.kind === "success") toast.success(notice.message);
  else if (notice.kind === "error") toast.error(notice.message);
  else if (notice.kind === "warning") toast.warning(notice.message);
  else toast(notice.message);
}

function describe(c: Celebration): { title: string; detail: string } {
  const what = c.files === 1 ? (c.fileNames[0] ?? "1 file") : `${c.files} files`;
  const verb = c.direction === "outgoing" ? "Sent" : "Received";
  const parts = [formatBytes(c.bytes)];
  if (c.seconds >= 1) parts.push(`in ${formatDuration(c.seconds)}`);
  if (c.averageSpeed) parts.push(`· ${formatSpeed(c.averageSpeed)} avg`);
  return { title: `${verb} ${what}`, detail: parts.join(" ") };
}

function shareResult(c: Celebration): void {
  void shareResultCard(
    {
      headline: `${c.direction === "outgoing" ? "Sent" : "Received"} ${formatBytes(c.bytes)}${c.seconds >= 1 ? ` in ${formatDuration(c.seconds)}` : ""}`,
      detail: [c.averageSpeed ? `${formatSpeed(c.averageSpeed)} average` : null, c.peakSpeed ? `top ${formatSpeed(c.peakSpeed)}` : null]
        .filter(Boolean)
        .join(" · "),
    },
    `I just moved ${formatBytes(c.bytes)} with ${brand.name} ⚡`,
  );
}

function useSessionEffects(session: RoomSession): void {
  const seenRequests = useRef(new Set<string>());
  const seenTexts = useRef(new Set<string>());
  const seenPairs = useRef(new Set<string>());

  useEffect(() => session.notices.on("notice", showNotice), [session]);

  // Sounds, confetti, haptics, the flight path and a toast with "Share" when a batch finishes.
  useEffect(
    () =>
      session.celebrations.on("celebration", (c) => {
        const { title, detail } = describe(c);
        playSound(c.newRecord ? "record" : c.direction === "outgoing" ? "send" : "receive");
        for (const peerId of c.peerIds.slice(0, 6)) {
          if (c.direction === "outgoing") flyFile(TRANSFERS_ANCHOR, deviceAnchor(peerId));
          else flyFile(deviceAnchor(peerId), TRANSFERS_ANCHOR);
        }
        vibrate(c.direction === "incoming" ? [30, 60, 30] : 25);
        if (c.newRecord || c.bytes >= 50_000_000 || c.files >= 3) confetti(c.newRecord ? "big" : "small");
        toast.success(c.newRecord ? `${title}. New personal record! 🏆` : title, {
          description: detail,
          action: c.bytes >= 10_000_000 ? { label: "Share", onPress: () => shareResult(c) } : undefined,
        });
        notifyInBackground(c.direction === "incoming" ? "Files received" : "Files sent", `${title} · ${detail}`);
      }),
    [session],
  );

  // Incoming requests, texts and pairing requests: a sound and haptic now, a notification if
  // the app is in the background.
  useEffect(() => {
    const offRequests = session.transfers.store.subscribe(() => {
      for (const request of session.transfers.store.getSnapshot().requests) {
        if (seenRequests.current.has(request.key)) continue;
        seenRequests.current.add(request.key);
        playSound("request");
        vibrate([40, 40, 40]);
        const files = request.transferIds.length;
        notifyInBackground(
          "Incoming files",
          `${session.deviceName(request.senderId)} wants to send you ${files === 1 ? "a file" : `${files} files`} (${formatBytes(request.totalBytes)})`,
          { roomId: session.session.roomId },
        );
      }
    });
    const offInbox = session.inbox.subscribe(() => {
      for (const m of session.inbox.getSnapshot()) {
        if (m.direction !== "in" || seenTexts.current.has(m.id)) continue;
        seenTexts.current.add(m.id);
        notifyInBackground(m.kind === "chat" ? `Message from ${session.deviceName(m.peerIds[0] ?? "")}` : "New text", m.text.slice(0, 120), {
          roomId: session.session.roomId,
        });
      }
    });
    const offPairs = session.pairRequests.subscribe(() => {
      for (const r of session.pairRequests.getSnapshot()) {
        if (seenPairs.current.has(r.peerId)) continue;
        seenPairs.current.add(r.peerId);
        notifyInBackground("Pairing request", `${r.name} wants to add this device to My devices`, { roomId: session.session.roomId });
      }
    });
    return () => {
      offRequests();
      offInbox();
      offPairs();
    };
  }, [session]);

  // Keep the screen on while anything is moving (the OS suspends background apps).
  const transfers = useSyncExternalStore(session.transfers.store.subscribe, session.transfers.store.getSnapshot, session.transfers.store.getSnapshot);
  useWakeLock(transfers.items.some(isActive));
}

function ActiveSessionEffects({ session }: { session: RoomSession }) {
  useSessionEffects(session);
  return null;
}

export function SessionEffects() {
  const session = useSyncExternalStore(activeSession.subscribe, activeSession.getSnapshot, activeSession.getSnapshot);
  return session ? <ActiveSessionEffects key={session.session.roomId} session={session} /> : null;
}
