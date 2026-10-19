// Native confirmation dialogs (the website's AlertDialogs) — system alerts feel right on both
// platforms and are fully accessible.
import { Alert } from "react-native";
import { haptic } from "@/lib/fun/celebrate";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export function confirm({ title, message, confirmLabel, cancelLabel = "Cancel", destructive = false }: ConfirmOptions): Promise<boolean> {
  if (destructive) haptic.warning();
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: "cancel", onPress: () => resolve(false) },
        { text: confirmLabel, style: destructive ? "destructive" : "default", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
