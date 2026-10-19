// Backend connection diagnostics: API health, transfer config, and whether the signaling
// server accepts this app's WebSocket Origin (the one setting that must change on the backend).
import { CircleCheck, RefreshCw, TriangleAlert, XCircle } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { env } from "@/config/env";
import { getTransferConfig } from "@/lib/api/config";
import { detectDevice } from "@/lib/device/detection";
import { formatBytes } from "@/lib/utils/format";
import { nativeSocketFactory } from "@/lib/webrtc/signaling-client";
import { useTheme } from "@/theme/theme-provider";
import { space } from "@/theme/tokens";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Divider } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { SectionHeader } from "@/components/ui/states";
import { Text } from "@/components/ui/text";

type Check = { state: "pending" } | { state: "ok"; detail: string } | { state: "warn"; detail: string } | { state: "fail"; detail: string };

const apiOrigin = env.apiUrl.replace(/\/api\/v1\/?$/, "");

async function checkHealth(): Promise<Check> {
  try {
    const response = await fetch(`${apiOrigin}/api/health`);
    if (!response.ok) return { state: "fail", detail: `HTTP ${response.status}` };
    const body = (await response.json()) as { status?: string; version?: string };
    return { state: "ok", detail: `${body.status ?? "ok"}${body.version ? ` · v${body.version}` : ""}` };
  } catch (error) {
    return { state: "fail", detail: `Can't reach ${apiOrigin}. On a phone, use your computer's LAN address, not localhost. (${String(error)})` };
  }
}

async function checkConfig(): Promise<Check> {
  try {
    const config = await getTransferConfig();
    return { state: "ok", detail: `chunk ${formatBytes(config.recommended_chunk_size)} · up to ${config.max_recipients} recipients · resume window ${Math.round(config.resume_window_seconds / 60)} min` };
  } catch (error) {
    return { state: "fail", detail: String(error) };
  }
}

/**
 * Opens a socket to a non-existent room with a bogus token. The server checks the Origin
 * before anything else: 4003 means the Origin is not on WS_ALLOWED_ORIGINS; 4001/4004 (or an
 * accepted socket) means it is.
 */
function checkWebSocket(): Promise<Check> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (check: Check) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // already closed
      }
      resolve(check);
    };
    const socket = nativeSocketFactory(env.wsOrigin)(`${env.wsUrl}/rooms/rm_diagnostics`);
    const timer = setTimeout(() => done({ state: "warn", detail: "No answer within 8 s." }), 8000);
    socket.onopen = () => socket.send(JSON.stringify({ type: "join", token: "diagnostics" }));
    socket.onclose = (event) => {
      if (event.code === 4003) {
        done({ state: "fail", detail: `Origin "${env.wsOrigin}" is not allowed. Add it to WS_ALLOWED_ORIGINS on the backend (keep the website's origins too).` });
      } else if (event.code === 4001 || event.code === 4004) {
        done({ state: "ok", detail: `Origin accepted (closed with ${event.code} for the test token, as expected).` });
      } else {
        done({ state: "warn", detail: `Closed with code ${event.code}.` });
      }
    };
    socket.onerror = () => undefined;
  });
}

function Row({ label, check }: { label: string; check: Check }) {
  const { colors } = useTheme();
  const Icon = check.state === "ok" ? CircleCheck : check.state === "fail" ? XCircle : check.state === "warn" ? TriangleAlert : RefreshCw;
  const color = check.state === "ok" ? colors.success : check.state === "fail" ? colors.destructive : check.state === "warn" ? colors.warning : colors.mutedForeground;
  return (
    <View style={{ flexDirection: "row", gap: space.md, paddingVertical: space.sm }}>
      <Icon size={20} color={color} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">{label}</Text>
        <Text variant="footnote" tone="muted" selectable>
          {check.state === "pending" ? "Checking…" : check.detail}
        </Text>
      </View>
    </View>
  );
}

export default function DiagnosticsScreen() {
  const [health, setHealth] = useState<Check>({ state: "pending" });
  const [config, setConfig] = useState<Check>({ state: "pending" });
  const [socket, setSocket] = useState<Check>({ state: "pending" });
  const start = useCallback(() => {
    void checkHealth().then(setHealth);
    void checkConfig().then(setConfig);
    void checkWebSocket().then(setSocket);
  }, []);
  const run = () => {
    setHealth({ state: "pending" });
    setConfig({ state: "pending" });
    setSocket({ state: "pending" });
    start();
  };
  useEffect(start, [start]);
  const device = detectDevice();

  return (
    <Screen title="Diagnostics" subtitle="Checks the connection to the Droply server." back actions={<Button label="Run again" icon={RefreshCw} size="sm" variant="tinted" onPress={run} />}>
      <Card style={{ paddingVertical: space.xs }}>
        <Row label="API" check={health} />
        <Divider inset={32} />
        <Row label="Transfer settings" check={config} />
        <Divider inset={32} />
        <Row label="Signaling (WebSocket)" check={socket} />
      </Card>
      <SectionHeader title="Configuration" />
      <Card style={{ gap: space.sm }}>
        {[
          ["API URL", env.apiUrl],
          ["WebSocket URL", env.wsUrl],
          ["WebSocket Origin", env.wsOrigin],
          ["Website URL", env.webUrl ?? "from join links"],
          ["Configured for this build", env.configured ? "yes" : "no — using localhost defaults"],
          ["Max open transfers", String(env.maxActiveTransfers)],
          ["This device", `${device.os} · ${device.type} · ${device.browser}`],
        ].map(([label, value]) => (
          <View key={label} style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}>
            <Text variant="footnote" tone="muted">
              {label}
            </Text>
            <Text variant="footnote" selectable style={{ flexShrink: 1, textAlign: "right", fontWeight: "600" }}>
              {value}
            </Text>
          </View>
        ))}
      </Card>
    </Screen>
  );
}
