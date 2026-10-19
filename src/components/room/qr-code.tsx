// QR code of the backend's join_url, exactly as returned (same as the website). Always dark
// on white so every camera reads it, even in dark mode. Fades and scales in.
import { View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import Animated, { ZoomIn } from "react-native-reanimated";
import { useTheme } from "@/theme/theme-provider";
import { elevation, radius } from "@/theme/tokens";

export function QrCode({ value, size = 200 }: { value: string; size?: number }) {
  const { colors } = useTheme();
  return (
    <Animated.View entering={ZoomIn.springify().damping(16)} accessible accessibilityRole="image" accessibilityLabel="QR code to join this room">
      <View style={[{ padding: 14, backgroundColor: "#ffffff", borderRadius: radius.xl }, elevation(2, colors)]}>
        <QRCode value={value} size={size} color="#0b0c1a" backgroundColor="#ffffff" ecl="M" quietZone={0} />
      </View>
    </Animated.View>
  );
}
