// Shareable image cards ("I just sent 4.2 GB in 51 s with Droply ⚡"). Only numbers and the
// product name: no file names, so nothing private is shared by default. The card itself is
// a React Native view (components/share/result-card.tsx) captured as a PNG with
// react-native-view-shot; the website draws the same card on a canvas.
import * as Sharing from "expo-sharing";
import { logger } from "@/lib/utils/logger";

export interface CardContent {
  headline: string;
  detail: string;
  footer?: string;
}

/** Opens the share sheet with the captured card image. */
export async function shareCard(imageUri: string, text: string): Promise<"shared" | "cancelled"> {
  if (!(await Sharing.isAvailableAsync())) return "cancelled";
  try {
    await Sharing.shareAsync(imageUri, { mimeType: "image/png", dialogTitle: text, UTI: "public.png" });
    return "shared";
  } catch (error) {
    logger.warn("share", "sharing the card failed", String(error));
    return "cancelled";
  }
}
