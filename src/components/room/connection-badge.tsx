// How this device is connected to a peer. A path is only claimed once getStats() reports the
// selected candidate pair; until then it says "Connecting…" (website parity).
import { Globe, LoaderCircle, RefreshCw, TriangleAlert, Zap } from "lucide-react-native";
import { View } from "react-native";
import type { LinkInfo } from "@/lib/webrtc/peer-connection";
import { useTheme } from "@/theme/theme-provider";
import { space } from "@/theme/tokens";
import { Badge } from "@/components/ui/badge";
import { Text } from "@/components/ui/text";

export function ConnectionBadge({ link }: { link: LinkInfo | undefined }) {
  if (!link || link.status === "idle" || link.status === "closed") return null;
  if (link.status === "failed") return <Badge variant="destructive" icon={TriangleAlert} label="No connection" />;
  if (link.status === "recovering") return <Badge variant="warning" icon={RefreshCw} label="Trying another route…" />;
  if (link.status === "connecting" || link.path === "unknown") return <Badge variant="secondary" icon={LoaderCircle} label="Connecting…" />;
  if (link.path === "relay") return <Badge variant="warning" icon={RefreshCw} label="Relay connection" />;
  if (link.path === "lan") return <Badge variant="success" icon={Zap} label="Direct connection" />;
  return <Badge variant="electric" icon={Globe} label="Internet connection" />;
}

const QUALITY: Record<NonNullable<LinkInfo["quality"]>, { label: string; symbol: string; tone: "success" | "electric" | "warning" }> = {
  excellent: { label: "Excellent", symbol: "⚡", tone: "success" },
  good: { label: "Good", symbol: "●", tone: "electric" },
  weak: { label: "Weak", symbol: "△", tone: "warning" },
};

/** Connection quality from measured RTT. Shows nothing without a measurement. */
export function QualityIndicator({ link }: { link: LinkInfo | undefined }) {
  const { colors } = useTheme();
  if (!link?.quality || link.status !== "connected") return null;
  const q = QUALITY[link.quality];
  const color = { success: colors.success, electric: colors.electric, warning: colors.warning }[q.tone];
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}
      accessible
      accessibilityLabel={`${q.label}${link.rttMs !== null ? `, ${link.rttMs} milliseconds latency` : ""}`}
    >
      <Text variant="caption" color={color}>
        {q.symbol}
      </Text>
      <Text variant="caption" tone="muted">
        {q.label}
        {link.rttMs !== null ? ` · ${link.rttMs} ms` : ""}
      </Text>
    </View>
  );
}
