// Best-effort device identification for the UI only. Never used for security: the
// server issues device identity, and users can edit everything detected here.
import * as Device from "expo-device";
import { Platform } from "react-native";
import type { DeviceType } from "@/types/device";

export interface DetectedDevice {
  type: DeviceType;
  browser: string;
  os: string;
}

export interface DetectionInput {
  userAgent: string;
  maxTouchPoints: number;
  screenShortSide: number;
  uaDataMobile?: boolean;
  uaDataPlatform?: string;
  uaDataBrands?: readonly { brand: string }[];
}

function detectOs(ua: string, platform: string | undefined, touch: number): string {
  const p = platform?.toLowerCase() ?? "";
  if (/iphone|ipod/i.test(ua)) return "iOS";
  if (/ipad/i.test(ua) || (/macintosh/i.test(ua) && touch > 1)) return "iPadOS";
  if (p === "android" || /android/i.test(ua)) return "Android";
  if (p === "chrome os" || /cros/i.test(ua)) return "ChromeOS";
  if (p === "windows" || /windows/i.test(ua)) return "Windows";
  if (p === "macos" || /macintosh|mac os x/i.test(ua)) return "macOS";
  if (p === "linux" || /linux/i.test(ua)) return "Linux";
  return "Unknown OS";
}

function detectBrowser(ua: string, brands: readonly { brand: string }[] | undefined): string {
  const names = brands?.map((b) => b.brand) ?? [];
  if (names.includes("Microsoft Edge")) return "Edge";
  if (names.includes("Opera")) return "Opera";
  if (names.includes("Brave")) return "Brave";
  if (/edg(e|a|ios)?\//i.test(ua)) return "Edge";
  if (/opr\/|opera/i.test(ua)) return "Opera";
  if (/samsungbrowser/i.test(ua)) return "Samsung Internet";
  if (/firefox|fxios/i.test(ua)) return "Firefox";
  if (/crios/i.test(ua)) return "Chrome";
  if (/chrome|chromium/i.test(ua) || names.includes("Google Chrome")) return "Chrome";
  if (/safari/i.test(ua)) return "Safari";
  return "Browser";
}

export function detectFrom(input: DetectionInput): DetectedDevice {
  const { userAgent: ua, maxTouchPoints: touch } = input;
  const os = detectOs(ua, input.uaDataPlatform, touch);
  const browser = detectBrowser(ua, input.uaDataBrands);

  let type: DeviceType;
  if (os === "iOS") type = "phone";
  else if (os === "iPadOS") type = "tablet";
  else if (os === "Android") {
    // Android tablets usually omit "Mobile" from the UA; a small screen means a phone anyway.
    const mobile = input.uaDataMobile ?? /mobile/i.test(ua);
    const smallScreen = input.screenShortSide > 0 && input.screenShortSide < 600;
    type = mobile || smallScreen ? "phone" : "tablet";
  } else if (os === "macOS" || os === "ChromeOS") type = "laptop";
  else if (os === "Windows" || os === "Linux") type = "desktop";
  else type = "unknown";

  return { type, browser, os };
}

/** What the app reports as its "browser"; the website shows it as "Android • Droply app". */
export const APP_CLIENT_NAME = "Droply app";

let cached: DetectedDevice | null = null;

/** This device, from the OS (no user-agent guessing needed in a native app). */
export function detectDevice(): DetectedDevice {
  if (cached) return cached;
  const tablet = Device.deviceType === Device.DeviceType.TABLET;
  let os: string;
  if (Platform.OS === "ios") os = tablet ? "iPadOS" : "iOS";
  else if (Platform.OS === "android") os = "Android";
  else os = "Unknown OS";
  cached = { type: tablet ? "tablet" : "phone", browser: APP_CLIENT_NAME, os };
  return cached;
}

/** Phones and tablets are never desktops; kept for parity with the website's API. */
export async function refineDesktopOrLaptop(device: DetectedDevice): Promise<DetectedDevice> {
  return device;
}
