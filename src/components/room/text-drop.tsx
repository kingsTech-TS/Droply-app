// Text drop (website: text-drop.tsx): send a link, note or password straight to devices over
// the encrypted peer-to-peer channel, and the inbox of texts in this room (memory only).
import * as Clipboard from "expo-clipboard";
import { Check, ClipboardPaste, Copy, ExternalLink, MessageSquareText, Send } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import Animated, { FadeInDown, LinearTransition } from "react-native-reanimated";
import { haptic } from "@/lib/fun/celebrate";
import type { InboxMessage } from "@/lib/session/room-session";
import { MAX_TEXT_MESSAGE } from "@/lib/webrtc/protocol";
import { space } from "@/theme/tokens";
import type { DeviceView } from "@/types/device";
import { RecipientSelector } from "@/components/transfer/send-panel";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { SectionHeader } from "@/components/ui/states";
import { Text } from "@/components/ui/text";
import { toast } from "@/components/ui/toast";

export interface TextDropSheetProps {
  visible: boolean;
  onClose: () => void;
  devices: DeviceView[];
  initialRecipients: ReadonlySet<string>;
  initialText?: string;
  onSend: (peerIds: string[], text: string) => Promise<number>;
}

export function TextDropSheet({ visible, onClose, devices, initialRecipients, initialText = "", onSend }: TextDropSheetProps) {
  const [text, setText] = useState(initialText);
  const [recipients, setRecipients] = useState<Set<string>>(new Set(initialRecipients));
  const [busy, setBusy] = useState(false);
  const [lastVisible, setLastVisible] = useState(visible);
  if (visible !== lastVisible) {
    setLastVisible(visible);
    if (visible) {
      setText(initialText);
      setRecipients(new Set(initialRecipients.size ? initialRecipients : devices.length === 1 ? [devices[0]!.device_id] : []));
    }
  }
  const paste = async () => {
    const value = await Clipboard.getStringAsync().catch(() => "");
    if (value) setText(value.slice(0, MAX_TEXT_MESSAGE));
    else toast("The clipboard is empty.");
  };
  const send = async () => {
    setBusy(true);
    const delivered = await onSend([...recipients], text);
    setBusy(false);
    if (delivered > 0) {
      toast.success(delivered === 1 ? "Text sent" : `Text sent to ${delivered} devices`);
      onClose();
    }
  };
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      icon={MessageSquareText}
      title="Send text or a link"
      subtitle="Goes straight to the other device over the encrypted connection."
      footer={<Button label={busy ? "Sending…" : "Send"} icon={Send} size="lg" onPress={() => void send()} disabled={busy || !text.trim() || recipients.size === 0} loading={busy} fullWidth />}
    >
      <Input value={text} onChangeText={(v) => setText(v.slice(0, MAX_TEXT_MESSAGE))} placeholder="A link, an address, a Wi-Fi password…" accessibilityLabel="Text to send" multiline autoFocus />
      <View style={styles.between}>
        <Button label="Paste from clipboard" icon={ClipboardPaste} size="sm" variant="ghost" onPress={() => void paste()} />
        <Text variant="caption" tone="muted">
          {text.length.toLocaleString()} / {MAX_TEXT_MESSAGE.toLocaleString()}
        </Text>
      </View>
      <RecipientSelector devices={devices} selected={recipients} onChange={setRecipients} />
    </Sheet>
  );
}

function asHttpUrl(text: string): string | null {
  const trimmed = text.trim();
  if (/\s/.test(trimmed)) return null;
  return /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(trimmed) ? trimmed : null;
}

function InboxItem({ message, from }: { message: InboxMessage; from: string }) {
  const [copied, setCopied] = useState(false);
  const url = asHttpUrl(message.text);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <Animated.View entering={FadeInDown.springify().damping(18)} layout={LinearTransition}>
      <Card style={{ gap: space.sm }}>
        <Text variant="caption" tone="muted">
          {message.direction === "in" ? `From ${from}` : `You sent to ${from}`} · {new Date(message.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </Text>
        <Text selectable>{message.text}</Text>
        <View style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}>
          <Button
            label={copied ? "Copied" : "Copy"}
            icon={copied ? Check : Copy}
            size="sm"
            variant="outline"
            onPress={() =>
              void Clipboard.setStringAsync(message.text).then(() => {
                haptic.success();
                setCopied(true);
              })
            }
          />
          {/* Opened only on an explicit tap, in the browser. */}
          {url && message.direction === "in" ? <Button label="Open link" icon={ExternalLink} size="sm" variant="ghost" onPress={() => void Linking.openURL(url)} /> : null}
        </View>
      </Card>
    </Animated.View>
  );
}

export function TextInbox({ messages, deviceName }: { messages: InboxMessage[]; deviceName: (id: string) => string }) {
  const texts = messages.filter((m) => m.kind === "text").slice().reverse();
  if (texts.length === 0) return null;
  return (
    <View style={{ gap: space.sm }}>
      <SectionHeader title="Texts" icon={MessageSquareText} />
      {texts.map((message) => (
        <InboxItem key={message.id} message={message} from={message.peerIds.map(deviceName).join(", ") || "nobody"} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
