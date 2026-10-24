// Room chat over the peer-to-peer channel: nothing is stored on the server (website:
// chat-panel.tsx). In group rooms (more than 3 devices) people can tag someone with @,
// reply to a message, and react to it.
import { AtSign, CornerUpLeft, MessagesSquare, Send, SmilePlus, X } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance, type TextInputInstance } from "react-native";
import Animated, { FadeIn, FadeInUp, FadeOut } from "react-native-reanimated";
import { escapeRegExp, findMentions, mentionQuery } from "@/lib/chat/mentions";
import { haptic } from "@/lib/fun/celebrate";
import { CHAT_GROUP_MIN_DEVICES, type ChatSendOptions, type InboxMessage } from "@/lib/session/room-session";
import { MAX_CHAT_MESSAGE, REACTIONS, type Reaction } from "@/lib/webrtc/protocol";
import { useTheme } from "@/theme/theme-provider";
import { radius, space } from "@/theme/tokens";
import type { DeviceView } from "@/types/device";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Text } from "@/components/ui/text";

export { findMentions };

export interface ChatSheetProps {
  visible: boolean;
  onClose: () => void;
  messages: InboxMessage[];
  deviceName: (id: string) => string;
  onSend: (text: string, options: ChatSendOptions) => Promise<void>;
  onReact: (messageId: string, emoji: Reaction) => void;
  peersOnline: number;
  selfId: string;
  /** Every device in the room, this one included. */
  devices: DeviceView[];
  /** The room's time is up: nothing new can be sent. */
  locked?: boolean;
  /** Shown in place of the message box text while locked. */
  lockedReason?: string;
}

export function ChatSheet({ visible, onClose, messages, deviceName, onSend, onReact, peersOnline, selfId, devices, locked = false, lockedReason }: ChatSheetProps) {
  const { colors } = useTheme();
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [replyTo, setReplyTo] = useState<InboxMessage | null>(null);
  const [picker, setPicker] = useState<string | null>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const list = useRef<ScrollViewInstance>(null);
  const input = useRef<TextInputInstance>(null);
  const offsets = useRef(new Map<string, number>());
  const chat = messages.filter((m) => m.kind === "chat");
  const group = devices.length >= CHAT_GROUP_MIN_DEVICES;
  const interactive = group && !locked && peersOnline > 0;
  const others = useMemo(() => devices.filter((d) => d.device_id !== selfId), [devices, selfId]);
  const suggestions = useMemo(
    () => (interactive && mention ? others.filter((d) => d.device_name.toLowerCase().includes(mention.query)).slice(0, 6) : []),
    [interactive, mention, others],
  );
  const nameOf = (id: string) => (id === selfId ? "You" : deviceName(id));

  useEffect(() => {
    const t = setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [chat.length, visible]);

  const focusAt = (position: number) => {
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelection?.(position, position);
    });
  };

  const updateText = (value: string, at: number) => {
    setText(value.slice(0, MAX_CHAT_MESSAGE));
    setCaret(at);
    setMention(group ? mentionQuery(value, at) : null);
  };

  const pickMention = (device: DeviceView) => {
    if (!mention) return;
    haptic.select();
    const end = mention.start + 1 + mention.query.length;
    const next = `${text.slice(0, mention.start)}@${device.device_name} ${text.slice(end)}`;
    const position = mention.start + device.device_name.length + 2;
    setText(next.slice(0, MAX_CHAT_MESSAGE));
    setCaret(position);
    setMention(null);
    focusAt(position);
  };

  const startMention = () => {
    const at = Math.min(caret, text.length);
    const spacer = at > 0 && !/\s/.test(text[at - 1] ?? "") ? " " : "";
    const next = `${text.slice(0, at)}${spacer}@${text.slice(at)}`;
    const position = at + spacer.length + 1;
    updateText(next, position);
    focusAt(position);
  };

  const submit = () => {
    const value = text.trim();
    if (!value || locked || peersOnline === 0) return;
    const options: ChatSendOptions = group ? { replyTo, mentions: findMentions(value, others) } : {};
    setText("");
    setCaret(0);
    setReplyTo(null);
    setMention(null);
    void onSend(value, options);
  };

  const reply = (message: InboxMessage) => {
    haptic.select();
    setReplyTo(message);
    setPicker(null);
    focusAt(text.length);
  };

  const jumpTo = (id: string) => {
    const y = offsets.current.get(id);
    if (y === undefined) return;
    list.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
    setFlash(id);
    setTimeout(() => setFlash((current) => (current === id ? null : current)), 1200);
  };

  /** Text with each tagged "@Name" highlighted (this device's own name stands out more). */
  const withMentions = (value: string, mentions: readonly string[] | undefined, mine: boolean): ReactNode => {
    if (!mentions?.length) return value;
    const names = new Map(mentions.map((id) => [deviceName(id), id]));
    const sorted = [...names.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
    const parts = value.split(new RegExp(`(@(?:${sorted.join("|")}))`, "u"));
    return parts.map((part, index) => {
      const id = part.startsWith("@") ? names.get(part.slice(1)) : undefined;
      if (!id) return part;
      return (
        <Text
          key={index}
          style={[
            { fontWeight: "700" },
            id === selfId ? { backgroundColor: colors.warningSoft, color: colors.foreground } : { textDecorationLine: "underline", textDecorationStyle: "dotted" },
            mine && id !== selfId ? { color: colors.primaryForeground } : null,
          ]}
        >
          {part}
        </Text>
      );
    });
  };

  const placeholder = locked
    ? (lockedReason ?? "Time's up. The chat is closed.")
    : peersOnline === 0
      ? "Waiting for other devices…"
      : group
        ? "Message everyone, @ to tag someone"
        : "Message everyone in the room";

  return (
    <Sheet
      visible={visible}
      onClose={() => {
        setPicker(null);
        onClose();
      }}
      icon={MessagesSquare}
      title="Room chat"
      subtitle={`Messages go directly to the ${peersOnline === 1 ? "other device" : `${peersOnline} other devices`} and disappear when you leave.${group ? " Tag someone with @, reply to a message or react to it." : ""}`}
      scroll={false}
      footer={
        <View style={{ gap: space.sm }}>
          {suggestions.length > 0 ? (
            <Animated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(100)} accessibilityRole="list" accessibilityLabel="Tag a device" style={[styles.suggestions, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {suggestions.map((device) => (
                <Pressable
                  key={device.device_id}
                  onPress={() => pickMention(device)}
                  accessibilityRole="button"
                  accessibilityLabel={`Tag ${device.device_name}`}
                  style={({ pressed }) => [styles.suggestion, pressed ? { backgroundColor: colors.muted } : null]}
                >
                  <AtSign size={14} color={colors.mutedForeground} />
                  <Text numberOfLines={1} style={{ flex: 1 }}>
                    {device.device_name}
                  </Text>
                  {device.connection_state !== "connected" ? (
                    <Text variant="caption" tone="muted">
                      offline
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </Animated.View>
          ) : null}
          {replyTo && !locked ? (
            <Animated.View entering={FadeIn.duration(150)} style={[styles.replyBar, { backgroundColor: colors.muted, borderLeftColor: colors.primary }]}>
              <CornerUpLeft size={14} color={colors.primary} style={{ marginTop: 2 }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text variant="caption" style={{ fontWeight: "700" }}>
                  Replying to {nameOf(replyTo.direction === "out" ? selfId : (replyTo.peerIds[0] ?? ""))}
                </Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {replyTo.text}
                </Text>
              </View>
              <IconButton icon={X} label="Cancel reply" size={16} onPress={() => setReplyTo(null)} />
            </Animated.View>
          ) : null}
          <View style={styles.composer}>
            {interactive ? <IconButton icon={AtSign} label="Tag someone" onPress={startMention} /> : null}
            <View style={{ flex: 1 }}>
              <Input
                ref={input}
                value={text}
                onChangeText={(v) => updateText(v, v.length >= text.length ? caret + (v.length - text.length) : Math.min(caret, v.length))}
                onSelectionChange={(e) => {
                  const at = e.nativeEvent.selection.end;
                  setCaret(at);
                  setMention(group ? mentionQuery(text, at) : null);
                }}
                onBlur={() => setMention(null)}
                placeholder={placeholder}
                accessibilityLabel="Message"
                editable={peersOnline > 0 && !locked}
                returnKeyType="send"
                onSubmitEditing={() => (suggestions.length > 0 ? pickMention(suggestions[0]!) : submit())}
                submitBehavior="submit"
                autoComplete="off"
              />
            </View>
            <IconButton icon={Send} label="Send message" variant="tinted" onPress={submit} disabled={!text.trim() || peersOnline === 0 || locked} />
          </View>
        </View>
      }
    >
      <ScrollView ref={list} style={{ maxHeight: 420, minHeight: 160 }} contentContainerStyle={{ gap: space.md, paddingVertical: space.sm }} accessibilityLiveRegion="polite" keyboardShouldPersistTaps="handled">
        {chat.length === 0 ? (
          <Text tone="muted" center style={{ marginTop: space.xl }}>
            Say hi 👋
          </Text>
        ) : null}
        {chat.map((m) => {
          const mine = m.direction === "out";
          const authorId = mine ? selfId : (m.peerIds[0] ?? "");
          const forMe = !mine && (m.mentions?.includes(selfId) || m.replyTo?.author === selfId);
          const reactions = Object.entries(m.reactions ?? {}) as [Reaction, string[]][];
          const ring = flash === m.id ? colors.primary : forMe ? colors.warning : "transparent";
          return (
            <Animated.View
              key={m.id}
              entering={FadeInUp.springify().damping(18)}
              onLayout={(e) => offsets.current.set(m.id, e.nativeEvent.layout.y)}
              style={{ alignItems: mine ? "flex-end" : "flex-start", gap: 4 }}
            >
              <View style={[styles.row, { flexDirection: mine ? "row-reverse" : "row" }]}>
                <Pressable
                  onLongPress={interactive ? () => {
                    haptic.select();
                    setPicker((current) => (current === m.id ? null : m.id));
                  } : undefined}
                  accessibilityHint={interactive ? "Long press to react" : undefined}
                  style={[
                    styles.bubble,
                    mine ? { backgroundColor: colors.primary, borderBottomRightRadius: 6 } : { backgroundColor: colors.muted, borderBottomLeftRadius: 6 },
                    { borderColor: ring },
                  ]}
                >
                  {!mine ? (
                    <Text variant="caption" tone="primary" style={{ fontWeight: "700" }}>
                      {nameOf(authorId)}
                    </Text>
                  ) : null}
                  {m.replyTo ? (
                    <Pressable
                      onPress={() => jumpTo(m.replyTo!.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Reply to ${nameOf(m.replyTo.author)}: ${m.replyTo.text}. Show message`}
                      style={[styles.quote, { borderLeftColor: mine ? colors.primaryForeground : colors.primary, backgroundColor: mine ? "rgba(255,255,255,0.16)" : colors.background }]}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <CornerUpLeft size={11} color={mine ? colors.primaryForeground : colors.foreground} />
                        <Text variant="caption" color={mine ? colors.primaryForeground : colors.foreground} style={{ fontWeight: "700" }}>
                          {nameOf(m.replyTo.author)}
                        </Text>
                      </View>
                      <Text variant="caption" color={mine ? colors.primaryForeground : colors.mutedForeground} numberOfLines={2} style={{ opacity: 0.85 }}>
                        {m.replyTo.text}
                      </Text>
                    </Pressable>
                  ) : null}
                  <Text color={mine ? colors.primaryForeground : colors.foreground} selectable>
                    {withMentions(m.text, m.mentions, mine)}
                  </Text>
                </Pressable>
                {interactive ? (
                  <View style={[styles.actions, { flexDirection: mine ? "row-reverse" : "row" }]}>
                    <IconButton icon={CornerUpLeft} label={`Reply to ${nameOf(authorId)}`} size={16} onPress={() => reply(m)} />
                    <IconButton
                      icon={SmilePlus}
                      label={picker === m.id ? "Close reactions" : "React"}
                      size={16}
                      onPress={() => setPicker((current) => (current === m.id ? null : m.id))}
                    />
                  </View>
                ) : null}
              </View>
              {picker === m.id ? (
                <Animated.View entering={FadeIn.duration(140)} accessibilityLabel="Pick a reaction" style={[styles.picker, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {REACTIONS.map((emoji) => (
                    <Pressable
                      key={emoji}
                      accessibilityRole="button"
                      accessibilityLabel={`React ${emoji}`}
                      onPress={() => {
                        haptic.select();
                        onReact(m.id, emoji);
                        setPicker(null);
                      }}
                      style={({ pressed }) => [styles.pickerItem, pressed ? { backgroundColor: colors.muted } : null]}
                    >
                      <Text style={{ fontSize: 20 }}>{emoji}</Text>
                    </Pressable>
                  ))}
                </Animated.View>
              ) : null}
              {reactions.length > 0 ? (
                <View style={[styles.reactions, { justifyContent: mine ? "flex-end" : "flex-start" }]}>
                  {reactions.map(([emoji, ids]) => {
                    const mineToo = ids.includes(selfId);
                    const who = ids.map(nameOf).join(", ");
                    return (
                      <Pressable
                        key={emoji}
                        disabled={!interactive}
                        accessibilityRole="button"
                        accessibilityState={{ selected: mineToo, disabled: !interactive }}
                        accessibilityLabel={`${emoji} from ${who}${interactive ? (mineToo ? ". Remove yours" : ". Add yours") : ""}`}
                        onPress={() => {
                          haptic.select();
                          onReact(m.id, emoji);
                        }}
                        style={[styles.reaction, { borderColor: mineToo ? colors.primary : colors.border, backgroundColor: mineToo ? colors.primarySoft : colors.card }]}
                      >
                        <Text style={{ fontSize: 13 }}>{emoji}</Text>
                        <Text variant="caption" style={{ fontVariant: ["tabular-nums"], fontWeight: "600" }}>
                          {ids.length}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </Animated.View>
          );
        })}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  composer: { flexDirection: "row", alignItems: "center", gap: space.sm },
  row: { maxWidth: "92%", alignItems: "center", gap: 2 },
  bubble: { flexShrink: 1, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg, gap: 2, borderWidth: 2 },
  quote: { borderLeftWidth: 2, borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: 4, marginBottom: 2 },
  actions: { flexShrink: 0 },
  picker: { flexDirection: "row", gap: 2, padding: 4, borderRadius: radius.pill, borderWidth: 1 },
  pickerItem: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  reactions: { flexDirection: "row", flexWrap: "wrap", gap: 4, maxWidth: "92%" },
  reaction: { flexDirection: "row", alignItems: "center", gap: 4, height: 30, paddingHorizontal: space.sm, borderRadius: radius.pill, borderWidth: 1 },
  replyBar: { flexDirection: "row", alignItems: "flex-start", gap: space.sm, borderLeftWidth: 2, borderRadius: radius.md, paddingLeft: space.md, paddingVertical: 4 },
  suggestions: { borderWidth: 1, borderRadius: radius.md, padding: 4 },
  suggestion: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 44, paddingHorizontal: space.sm, borderRadius: radius.sm },
});
