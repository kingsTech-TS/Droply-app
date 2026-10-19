import { router } from "expo-router";
import { Compass } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Screen } from "@/components/ui/screen";
import { EmptyState } from "@/components/ui/states";

export default function NotFound() {
  return (
    <Screen back>
      <EmptyState icon={Compass} title="This page doesn't exist." body="The link may be old or mistyped." action={<Button label="Go home" onPress={() => router.replace("/")} />} />
    </Screen>
  );
}
