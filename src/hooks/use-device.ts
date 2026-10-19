import { useMemo, useState } from "react";
import { detectDevice, type DetectedDevice } from "@/lib/device/detection";
import { cleanDeviceName, defaultDeviceName, loadDeviceName, saveDeviceName } from "@/lib/device/device-name";
import { funDeviceName } from "@/lib/fun/names";
import { localKv } from "@/lib/platform/kv";
import type { DeviceInfoIn } from "@/types/device";

const FUN_NAME_KEY = "droply:fun-name";

/** A playful default name, generated once per device so it stays the same across launches. */
function stableFunName(): string {
  try {
    const saved = localKv.getItem(FUN_NAME_KEY);
    if (saved) return saved;
    const name = funDeviceName();
    localKv.setItem(FUN_NAME_KEY, name);
    return name;
  } catch {
    return funDeviceName();
  }
}

export interface DeviceIdentity {
  device: DetectedDevice;
  name: string;
  setName: (name: string) => void;
  /** Picks a new random fun name. */
  shuffleName: () => void;
  /** Saves the (cleaned) name for next time and returns it. */
  commitName: () => string;
  /** The device info sent to the backend when creating or joining a room. */
  info: () => DeviceInfoIn;
}

/** Same behaviour as the website's useDevice(): remembered name → fun name → OS default. */
export function useDevice(): DeviceIdentity {
  const device = useMemo(() => detectDevice(), []);
  const [edited, setEdited] = useState<string | null>(null);
  const remembered = useMemo(() => loadDeviceName(), []);
  const fun = useMemo(() => stableFunName(), []);
  const name = edited ?? remembered ?? fun ?? defaultDeviceName(device);

  const commitName = () => {
    const cleaned = cleanDeviceName(name) || defaultDeviceName(device);
    saveDeviceName(cleaned);
    setEdited(cleaned);
    return cleaned;
  };

  return {
    device,
    name,
    setName: setEdited,
    shuffleName: () => setEdited(funDeviceName()),
    commitName,
    info: () => ({
      device_name: commitName(),
      device_type: device.type,
      browser: device.browser,
      operating_system: device.os,
    }),
  };
}

/** The current device info without a hook (for services). */
export function currentDeviceInfo(): DeviceInfoIn {
  const device = detectDevice();
  const name = loadDeviceName() ?? stableFunName();
  return { device_name: cleanDeviceName(name) || defaultDeviceName(device), device_type: device.type, browser: device.browser, operating_system: device.os };
}
