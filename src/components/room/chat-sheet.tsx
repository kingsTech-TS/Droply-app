// Room chat over the peer-to-peer channel: nothing is stored on the server (website parity).
import { MessagesSquare, Send } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, View, type ScrollViewInstance } from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";
import type { InboxMessage } from "@/lib/session/room-session";
import { MAX_CHAT_MESSAGE } from "@/lib/webrtc/protocol";
import { useTheme } from "@/theme/theme-provider";
import { radius, space } from "@/theme/tokens";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Text } from "@/components/ui/text";

export interface ChatSheetProps {
  visible: boolean;
  onClose: () => void;
  messages: InboxMessage[];
  deviceName: (id: string) => string;
  onSend: (text: string) => Promise<void>;
  peersOnline: number;
}

export function ChatSheet({ visible, onClose, messages, deviceName, onSend, peersOnline }: ChatSheetProps) {
  const { colors } = useTheme();
  const [text, setText] = useState("");
  const list = useRef<ScrollViewInstance>(null);
  const chat = messages.filter((m) => m.kind === "chat");
  useEffect(() => {
    const t = setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [chat.length, visible]);

  const submit = () => {
    const value = text.trim();
    if (!value) return;
    setText("");
    void onSend(value);
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      icon={MessagesSquare}
      title="Room chat"
      subtitle={`Messages go directly to the ${peersOnline === 1 ? "other device" : `${peersOnline} other devices`} and disappear when you leave.`}
      scroll={false}
      footer={
        <View style={styles.composer}>
          <View style={{ flex: 1 }}>
            <Input
              value={text}
              onChangeText={(v) => setText(v.slice(0, MAX_CHAT_MESSAGE))}
              placeholder={peersOnline > 0 ? "Message everyone in the room" : "Waiting for other devices…"}
              accessibilityLabel="Message"
              editable={peersOnline > 0}
              returnKeyType="send"
              onSubmitEditing={submit}
              blurOnSubmit={false}
            />
          </View>
          <IconButton icon={Send} label="Send message" variant="tinted" onPress={submit} disabled={!text.trim() || peersOnline === 0} />
        </View>
      }
    >
      <ScrollView ref={list} style={{ maxHeight: 380, minHeight: 160 }} contentContainerStyle={{ gap: space.sm, paddingVertical: space.sm }} accessibilityLiveRegion="polite">
        {chat.length === 0 ? (
          <Text tone="muted" center style={{ marginTop: space.xl }}>
            Say hi 👋
          </Text>
        ) : null}
        {chat.map((m) => {
          const mine = m.direction === "out";
          return (
            <Animated.View key={m.id} entering={FadeInUp.springify().damping(18)} style={{ alignItems: mine ? "flex-end" : "flex-start" }}>
              <View style={[styles.bubble, mine ? { backgroundColor: colors.primary, borderBottomRightRadius: 6 } : { backgroundColor: colors.muted, borderBottomLeftRadius: 6 }]}>
                {!mine ? (
                  <Text variant="caption" tone="primary" style={{ fontWeight: "700" }}>
                    {deviceName(m.peerIds[0] ?? "")}
                  </Text>
                ) : null}
                <Text color={mine ? colors.primaryForeground : colors.foreground} selectable>
                  {m.text}
                </Text>
              </View>
            </Animated.View>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  composer: { flexDirection: "row", alignItems: "center", gap: space.sm },
  bubble: { maxWidth: "82%", paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg, gap: 2 },
});
