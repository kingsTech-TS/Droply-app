// "Your device name" with the emoji avatar and the "random fun name" dice (website parity).
import { Dices } from "lucide-react-native";
import { View } from "react-native";
import { MAX_DEVICE_NAME } from "@/lib/device/device-name";
import type { DeviceIdentity } from "@/hooks/use-device";
import { space } from "@/theme/tokens";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { DeviceAvatar } from "./device-avatar";

export function DeviceNameField({ identity, hint = "Other devices in the room will see this name." }: { identity: DeviceIdentity; hint?: string }) {
  return (
    <Input
      label="Your device name"
      hint={hint}
      value={identity.name}
      onChangeText={identity.setName}
      maxLength={MAX_DEVICE_NAME}
      autoComplete="off"
      autoCorrect={false}
      returnKeyType="done"
      left={
        <View style={{ paddingVertical: space.sm }}>
          <DeviceAvatar name={identity.name} type={identity.device.type} size={34} />
        </View>
      }
      right={<IconButton icon={Dices} label="Pick a random fun name" size={20} onPress={identity.shuffleName} />}
    />
  );
}
