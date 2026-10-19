// My devices + personal room link (website: /my-devices, my-devices-manager.tsx).
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { Check, Copy, Link2, RefreshCw, Share2, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Share, View } from "react-native";
import Animated, { FadeOutLeft, LinearTransition } from "react-native-reanimated";
import { userMessage } from "@/lib/api/errors";
import { haptic } from "@/lib/fun/celebrate";
import { ensureRoomLinkKey, forgetPairedDevice, pairing, resetRoomLinkKey, roomLinkKey, roomLinkUrl, unpairAll } from "@/lib/pairing/pairing";
import { enterSharedRoom } from "@/lib/session/actions";
import { myRooms } from "@/lib/session/my-rooms";
import { frontendOrigin } from "@/lib/utils/join-url";
import { loadSession } from "@/lib/session/session-store";
import { useDevice } from "@/hooks/use-device";
import { useLocalStore } from "@/hooks/use-local-store";
import { space } from "@/theme/tokens";
import { DeviceAvatar } from "@/components/room/device-avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { confirm } from "@/components/ui/confirm";
import { IconButton } from "@/components/ui/icon-button";
import { Screen } from "@/components/ui/screen";
import { SectionHeader } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { toast } from "@/components/ui/toast";

/** The website's address, learned from any room's join link (when EXPO_PUBLIC_WEB_URL isn't set). */
function knownWebOrigin(): string | null {
  for (const room of myRooms.get()) {
    const session = loadSession(room.roomId);
    const origin = session ? frontendOrigin(session.joinUrl) : null;
    if (origin) return origin;
  }
  return null;
}

export default function MyDevicesScreen() {
  const state = useLocalStore(pairing);
  const linkKey = useLocalStore(roomLinkKey);
  const { info } = useDevice();
  const [busy, setBusy] = useState<"devices" | "link" | null>(null);
  const [copied, setCopied] = useState(false);

  const go = async (key: string, mode: "my-devices" | "room-link") => {
    setBusy(mode === "my-devices" ? "devices" : "link");
    try {
      const roomId = await enterSharedRoom(key, mode, info());
      router.replace({ pathname: "/room/[roomId]", params: { roomId } });
    } catch (error) {
      toast.error(userMessage(error));
      setBusy(null);
    }
  };

  const link = linkKey ? roomLinkUrl(linkKey, knownWebOrigin()) : null;
  const copy = async () => {
    if (!link) return;
    await Clipboard.setStringAsync(link);
    haptic.success();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const unpair = async () => {
    const ok = await confirm({ title: "Unpair this device?", message: "It will stop meeting your other devices automatically. You can pair again any time.", confirmLabel: "Unpair", cancelLabel: "Keep", destructive: true });
    if (ok) unpairAll();
  };

  return (
    <Screen title="My devices" subtitle="Paired devices find each other without a room code, and files between them are accepted automatically." back>
      <Card style={{ gap: space.md }}>
        {state.devices.length === 0 ? (
          <Text tone="muted">
            No paired devices yet. Open a room on two of your devices, then choose <Text style={{ fontWeight: "700" }}>Add to My devices</Text> in the other device&apos;s menu.
          </Text>
        ) : (
          state.devices.map((d) => (
            <Animated.View key={d.name} exiting={FadeOutLeft} layout={LinearTransition} style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
              <DeviceAvatar name={d.name} type={d.type} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {d.name}
                </Text>
                <Text variant="footnote" tone="muted">
                  Paired {new Date(d.pairedAt).toLocaleDateString()}
                </Text>
              </View>
              <IconButton icon={Trash2} label={`Forget ${d.name}`} size={18} onPress={() => forgetPairedDevice(d.name)} />
            </Animated.View>
          ))
        )}
        <Button label={busy === "devices" ? "Connecting…" : "Connect my devices"} onPress={() => state.key && void go(state.key, "my-devices")} disabled={!state.key || state.devices.length === 0 || busy !== null} loading={busy === "devices"} fullWidth />
        {state.key ? <Button label="Unpair all" variant="ghost" onPress={() => void unpair()} /> : null}
      </Card>

      <SectionHeader title="My room link" icon={Link2} />
      <Card style={{ gap: space.md }}>
        <Text tone="muted">
          A personal link that always opens your room. Share it with friends so they can drop files to you any time you have Droply open. Anyone with the link can join, so share it carefully and
          reset it if needed.
        </Text>
        {link ? (
          <Text variant="mono" selectable style={{ fontSize: 13 }}>
            {link}
          </Text>
        ) : (
          <Button label="Create my room link" variant="secondary" onPress={() => ensureRoomLinkKey()} />
        )}
        {link && linkKey ? (
          <View style={{ gap: space.sm }}>
            <Button label={busy === "link" ? "Opening…" : "Open my room"} onPress={() => void go(linkKey, "room-link")} disabled={busy !== null} loading={busy === "link"} fullWidth />
            <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
              <Button label={copied ? "Copied" : "Copy link"} icon={copied ? Check : Copy} size="sm" variant="outline" onPress={() => void copy()} />
              <Button label="Share" icon={Share2} size="sm" variant="outline" onPress={() => void Share.share({ title: "My Droply room", message: link, url: link }).catch(() => undefined)} />
              <Button
                label="Reset link"
                icon={RefreshCw}
                size="sm"
                variant="ghost"
                onPress={() => {
                  resetRoomLinkKey();
                  toast.success("New link created. The old one no longer works.");
                }}
              />
            </View>
          </View>
        ) : null}
      </Card>
    </Screen>
  );
}
