import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { brand } from "@/config/brand";
import { useTheme } from "@/theme/theme-provider";
import { space } from "@/theme/tokens";
import { LogoMark } from "@/components/brand/logo";
import { Features } from "@/components/home/features";
import { ActiveRooms, CurrentRoomCard, MyDevicesCard, NearbyRooms } from "@/components/home/home-sections";
import { JoinCard } from "@/components/home/join-card";
import { StartTiles } from "@/components/home/start-tiles";
import { TAB_BAR_SPACE } from "@/components/tab-bar";
import { Screen } from "@/components/ui/screen";
import { Text } from "@/components/ui/text";

export default function HomeScreen() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries();
    setRefreshing(false);
  };
  return (
    <Screen
      title={brand.name}
      eyebrow={<LogoMark size={40} />}
      subtitle={`${brand.tagline} ${brand.secondaryTagline}`}
      refreshing={refreshing}
      onRefresh={() => void refresh()}
      bottomInset={TAB_BAR_SPACE}
    >
      <CurrentRoomCard />
      <Animated.View entering={FadeInDown.delay(60).springify().damping(18)}>
        <StartTiles />
      </Animated.View>
      <View style={{ height: space.xl }} />
      <Animated.View entering={FadeInDown.delay(140).springify().damping(18)}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginBottom: space.md }}>
          <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
          <Text variant="footnote" tone="muted">
            or
          </Text>
          <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
        </View>
        <JoinCard />
      </Animated.View>
      <ActiveRooms />
      <NearbyRooms />
      <MyDevicesCard />
      <Features />
    </Screen>
  );
}
