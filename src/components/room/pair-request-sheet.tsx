// "Add to My devices?" (website: pair-request-dialog.tsx).
import { Link2 } from "lucide-react-native";
import { View } from "react-native";
import { pairing } from "@/lib/pairing/pairing";
import type { PairRequest } from "@/lib/session/room-session";
import { space } from "@/theme/tokens";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Text } from "@/components/ui/text";

export function PairRequestSheet({ request, onRespond }: { request: PairRequest | null; onRespond: (peerId: string, accept: boolean) => void }) {
  const alreadyInGroup = pairing.get().devices.length > 0 && pairing.get().key !== request?.key;
  return (
    <Sheet
      visible={request !== null}
      onClose={() => request && onRespond(request.peerId, false)}
      icon={Link2}
      title="Add to My devices?"
      footer={
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Button label="Not now" variant="outline" onPress={() => request && onRespond(request.peerId, false)} style={{ flex: 1 }} />
          <Button label="Pair" onPress={() => request && onRespond(request.peerId, true)} style={{ flex: 1 }} />
        </View>
      }
    >
      <Text tone="muted">
        <Text style={{ fontWeight: "700" }}>{request?.name}</Text> wants to pair with this device. Paired devices find each other without a room code and send files without asking each time. Only
        pair your own devices.
        {alreadyInGroup ? " This replaces your current pairing." : ""}
      </Text>
    </Sheet>
  );
}
