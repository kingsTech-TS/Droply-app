import { localKv } from "@/lib/platform/kv";
import type { DetectedDevice } from "./detection";

const STORAGE_KEY = "droply:device-name";
export const MAX_DEVICE_NAME = 64;

const TYPE_LABEL: Record<DetectedDevice["type"], string> = {
  phone: "Phone",
  tablet: "Tablet",
  laptop: "Laptop",
  desktop: "Desktop",
  unknown: "Device",
};

export function defaultDeviceName(device: DetectedDevice): string {
  if (device.os === "iOS") return "iPhone";
  if (device.os === "iPadOS") return "iPad";
  if (device.os === "macOS") return "Mac";
  if (device.os === "Unknown OS") return `${device.browser} ${TYPE_LABEL[device.type]}`;
  return `${device.os} ${TYPE_LABEL[device.type]}`;
}

export function cleanDeviceName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_DEVICE_NAME);
}

export function loadDeviceName(): string | null {
  try {
    const value = localKv.getItem(STORAGE_KEY);
    return value ? cleanDeviceName(value) || null : null;
  } catch {
    return null;
  }
}

export function saveDeviceName(name: string): void {
  try {
    localKv.setItem(STORAGE_KEY, cleanDeviceName(name));
  } catch {
    // Private mode or blocked storage: the name just isn't remembered.
  }
}
