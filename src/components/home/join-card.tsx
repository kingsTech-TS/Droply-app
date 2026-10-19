// "Join with a room code" (the website's JoinCodeForm), plus scanning the QR code.
import { router } from "expo-router";
import { ArrowRight, ScanLine } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { isValidRoomCode, ROOM_CODE_LENGTH } from "@/lib/utils/room-code";
import { space } from "@/theme/tokens";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CodeInput } from "@/components/ui/code-input";
import { Text } from "@/components/ui/text";

export function JoinCard() {
  const [code, setCode] = useState("");
  const [touched, setTouched] = useState(false);
  const valid = isValidRoomCode(code);
  const submit = (value = code) => {
    setTouched(true);
    if (isValidRoomCode(value)) {
      router.push({ pathname: "/join/[code]", params: { code: value } });
      setCode("");
      setTouched(false);
    }
  };
  return (
    <Card style={{ gap: space.md }}>
      <View style={{ gap: 2 }}>
        <Text variant="subhead">Join with a room code</Text>
        <Text variant="footnote" tone={touched && !valid ? "destructive" : "muted"}>
          {touched && !valid ? `Room codes have ${ROOM_CODE_LENGTH} letters and numbers.` : "Find the code on the other device."}
        </Text>
      </View>
      <CodeInput value={code} onChange={setCode} onSubmit={submit} error={touched && !valid} />
      <View style={{ flexDirection: "row", gap: space.sm }}>
        <Button label="Scan QR" icon={ScanLine} variant="secondary" onPress={() => router.push("/scan")} style={{ flex: 1 }} />
        <Button label="Join" iconRight={ArrowRight} onPress={() => submit()} disabled={code.length === 0} style={{ flex: 1 }} />
      </View>
    </Card>
  );
}
