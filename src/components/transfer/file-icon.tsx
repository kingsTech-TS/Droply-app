import {
  File,
  FileArchive,
  FileCode,
  FileHeadphone,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideoCamera,
  Presentation,
  type LucideIcon,
} from "lucide-react-native";
import { View } from "react-native";
import { fileKind, type FileKind } from "@/lib/utils/file-kind";
import { useTheme } from "@/theme/theme-provider";
import { radius } from "@/theme/tokens";

const ICONS: Record<FileKind, LucideIcon> = {
  video: FileVideoCamera,
  image: FileImage,
  audio: FileHeadphone,
  archive: FileArchive,
  pdf: FileText,
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  code: FileCode,
  other: File,
};

/** Display only: the name and MIME type come from the other device and only pick an icon. */
export function FileIcon({ name, mimeType, size = 44 }: { name: string; mimeType: string; size?: number }) {
  const { colors } = useTheme();
  const kind = fileKind(name, mimeType);
  const tint = {
    video: colors.electric,
    image: colors.success,
    audio: colors.warning,
    archive: colors.mutedForeground,
    pdf: colors.destructive,
    document: colors.primary,
    spreadsheet: colors.success,
    presentation: colors.warning,
    code: colors.electric,
    other: colors.accentForeground,
  }[kind];
  const Icon = ICONS[kind];
  return (
    <View
      accessible={false}
      importantForAccessibility="no"
      style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: `${tint}1f`, alignItems: "center", justifyContent: "center" }}
    >
      <Icon size={size * 0.48} color={tint} strokeWidth={2} />
    </View>
  );
}
