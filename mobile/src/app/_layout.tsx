import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { SessionProvider } from "../lib/session";
import { colors } from "../lib/theme";

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Moments" }} />
        <Stack.Screen name="settings" options={{ title: "Your Mac", presentation: "modal" }} />
        <Stack.Screen name="capture" options={{ headerShown: false }} />
        <Stack.Screen name="review" options={{ title: "Place & direct" }} />
        <Stack.Screen name="job/[id]" options={{ title: "Your moment" }} />
      </Stack>
    </SessionProvider>
  );
}
