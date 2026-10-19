// Settings: the website's Preferences dialog + theme toggle + device name, plus app-level
// items (My devices, storage, privacy, diagnostics, version).
import * as Application from "expo-application";
import { router } from "expo-router";
import { Bell, Gauge, HardDrive, Info, Laptop, Lock, Moon, PartyPopper, Shield, Smartphone, Stethoscope, Trophy, Vibrate, Volume2, ImageDown } from "lucide-react-native";
import { useState } from "react";
import { Linking, View } from "react-native";
import { brand } from "@/config/brand";
import { env } from "@/config/env";
import { cleanDeviceName, MAX_DEVICE_NAME, saveDeviceName } from "@/lib/device/device-name";
import { playSound } from "@/lib/fun/celebrate";
import { funDeviceName } from "@/lib/fun/names";
import { preferences, type Preferences } from "@/lib/fun/prefs";
import { requestNotificationPermission } from "@/lib/notifications/notifications";
import { pairing } from "@/lib/pairing/pairing";
import { receivedDirectory, sandboxTemporaryBytes } from "@/lib/storage/sinks/sandbox-sink";
import { formatBytes } from "@/lib/utils/format";
import { useDevice } from "@/hooks/use-device";
import { useLocalStore } from "@/hooks/use-local-store";
import { useTheme, type ThemePreference } from "@/theme/theme-provider";
import { space } from "@/theme/tokens";
import { DeviceAvatar } from "@/components/room/device-avatar";
import { TAB_BAR_SPACE } from "@/components/tab-bar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { confirm } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import { Divider, ListRow } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { Segmented } from "@/components/ui/segmented";
import { SectionHeader } from "@/components/ui/states";
import { SwitchRow } from "@/components/ui/switch-row";
import { Text } from "@/components/ui/text";
import { toast } from "@/components/ui/toast";

const ROWS: Array<{ key: keyof Preferences; label: string; hint: string; icon: typeof Bell }> = [
  { key: "sound", label: "Sounds", hint: "A whoosh when sending, a chime when files arrive.", icon: Volume2 },
  { key: "celebrations", label: "Celebrations", hint: "Confetti for big transfers and records.", icon: PartyPopper },
  { key: "haptics", label: "Vibration", hint: "Haptic feedback when something arrives.", icon: Vibrate },
  { key: "notifications", label: "Notifications", hint: "When files or texts arrive while Droply is in the background.", icon: Bell },
  { key: "sendSmallerPhotos", label: "Send smaller photos", hint: "Resize large photos before sending (saves time on slow networks).", icon: ImageDown },
];

function folderBytes(): number {
  try {
    const dir = receivedDirectory();
    return dir.exists ? (dir.size ?? 0) : 0;
  } catch {
    return 0;
  }
}

export default function SettingsScreen() {
  const { colors, preference, setPreference } = useTheme();
  const prefs = useLocalStore(preferences);
  const paired = useLocalStore(pairing);
  const identity = useDevice();
  const [name, setName] = useState(identity.name);
  const [storage, setStorage] = useState(() => ({ received: folderBytes(), temporary: sandboxTemporaryBytes() }));

  const toggle = async (key: keyof Preferences, value: boolean) => {
    if (key === "notifications" && value) {
      const granted = await requestNotificationPermission();
      if (!granted) {
        toast.error("Notifications are blocked. Allow them in Settings.", { action: { label: "Open Settings", onPress: () => void Linking.openSettings() } });
        return;
      }
    }
    preferences.set({ ...prefs, [key]: value });
    if (key === "sound" && value) playSound("receive");
  };

  const saveName = () => {
    const cleaned = cleanDeviceName(name);
    if (!cleaned) {
      setName(identity.name);
      return;
    }
    saveDeviceName(cleaned);
    identity.setName(cleaned);
    setName(cleaned);
  };

  const clearReceived = async () => {
    const ok = await confirm({
      title: "Delete received files?",
      message: "Removes the files kept in Droply's own storage. Files you saved to Photos, Files or a folder are not affected.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    try {
      const dir = receivedDirectory();
      if (dir.exists) dir.delete();
      setStorage({ received: 0, temporary: sandboxTemporaryBytes() });
      toast.success("Received files deleted");
    } catch {
      toast.error("Couldn't delete the files.");
    }
  };

  return (
    <Screen title="Settings" subtitle="Saved on this device only." bottomInset={TAB_BAR_SPACE}>
      <SectionHeader title="This device" icon={Smartphone} />
      <Card style={{ gap: space.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
          <DeviceAvatar name={name} type={identity.device.type} size={52} />
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {name}
            </Text>
            <Text variant="footnote" tone="muted">
              {identity.device.os} • {identity.device.browser}
            </Text>
          </View>
        </View>
        <Input
          label="Device name"
          hint="Other devices in a room see this name."
          value={name}
          onChangeText={setName}
          onBlur={saveName}
          onSubmitEditing={saveName}
          maxLength={MAX_DEVICE_NAME}
          returnKeyType="done"
          autoCorrect={false}
        />
        <Button
          label="Pick a random fun name"
          size="sm"
          variant="ghost"
          onPress={() => {
            const fresh = funDeviceName();
            saveDeviceName(fresh);
            identity.setName(fresh);
            setName(fresh);
          }}
        />
      </Card>

      <SectionHeader title="Appearance" icon={Moon} />
      <Segmented<ThemePreference>
        accessibilityLabel="Theme"
        options={[
          { value: "system", label: "System" },
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ]}
        value={preference}
        onChange={setPreference}
      />

      <SectionHeader title="Preferences" />
      <Card style={{ paddingVertical: space.xs }}>
        {ROWS.map((row, i) => (
          <View key={row.key}>
            {i > 0 ? <Divider inset={46} /> : null}
            <SwitchRow icon={row.icon} label={row.label} hint={row.hint} value={prefs[row.key]} onChange={(v) => void toggle(row.key, v)} />
          </View>
        ))}
      </Card>

      <SectionHeader title="Receiving" icon={Shield} />
      <Card style={{ paddingVertical: space.xs }}>
        <ListRow
          icon={Laptop}
          title="My devices"
          subtitle={paired.devices.length ? `${paired.devices.length} paired · files between them are accepted automatically` : "Pair your own devices to skip the code and the prompt"}
          onPress={() => router.push("/my-devices")}
        />
        <Divider inset={46} />
        <ListRow icon={Lock} title="Other devices always ask" subtitle="Nobody can send you files without your approval, unless you turn on auto-accept for a device in a room." />
      </Card>

      <SectionHeader title="Storage" icon={HardDrive} />
      <Card style={{ gap: space.sm }}>
        <Text variant="footnote" tone="muted">
          Received files kept by Droply: {formatBytes(storage.received)}
          {storage.temporary > 0 ? ` · unfinished transfers: ${formatBytes(storage.temporary)}` : ""}
        </Text>
        <Button label="Delete received files" size="sm" variant="outline" onPress={() => void clearReceived()} disabled={storage.received === 0} />
      </Card>

      <SectionHeader title="More" />
      <Card style={{ paddingVertical: space.xs }}>
        <ListRow icon={Trophy} title="Stats & badges" onPress={() => router.push("/stats")} />
        <Divider inset={46} />
        <ListRow icon={Gauge} title="Speed test" onPress={() => router.push("/speed-test")} />
        <Divider inset={46} />
        <ListRow icon={Lock} title="What our server sees" onPress={() => router.push("/privacy")} />
        <Divider inset={46} />
        <ListRow icon={Info} title={`About ${brand.name}`} onPress={() => router.push("/about")} />
        <Divider inset={46} />
        <ListRow icon={Stethoscope} title="Diagnostics" subtitle="Server connection and setup" onPress={() => router.push("/diagnostics")} />
        {env.benchmarkEnabled ? (
          <>
            <Divider inset={46} />
            <ListRow icon={Gauge} title="Benchmark" subtitle="Developer tool" onPress={() => router.push("/benchmark")} />
          </>
        ) : null}
      </Card>
      <Text variant="caption" tone="muted" center style={{ marginTop: space.xl, color: colors.mutedForeground }}>
        {brand.name} {Application.nativeApplicationVersion ?? "dev"} ({Application.nativeBuildVersion ?? "0"})
      </Text>
    </Screen>
  );
}
