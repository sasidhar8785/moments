import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { health, setServer as storeServer } from "../lib/api";
import { useSession } from "../lib/session";
import { colors } from "../lib/theme";

export default function Settings() {
  const { server, setServer } = useSession();
  const [input, setInput] = useState(server?.replace(/^http:\/\//, "") ?? "");
  const [state, setState] = useState<{ busy: boolean; message: string | null; ok: boolean }>({
    busy: false, message: null, ok: false,
  });

  async function save() {
    setState({ busy: true, message: null, ok: false });
    const url = await storeServer(input);
    try {
      await health(url);
      setServer(url);
      setState({ busy: false, message: "Connected.", ok: true });
      setTimeout(() => router.back(), 600);
    } catch (e) {
      setServer(url);
      setState({
        busy: false,
        ok: false,
        message: `Couldn't reach ${url}. Check the server is running on your Mac, both devices are on the same Wi-Fi, and the address is right. (${e instanceof Error ? e.message : e})`,
      });
    }
  }

  return (
    <View style={styles.page}>
      <Text style={styles.label}>Your Mac’s address</Text>
      <TextInput
        value={input}
        onChangeText={setInput}
        placeholder="192.168.1.20"
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={styles.input}
        onSubmitEditing={save}
      />
      <Text style={styles.help}>
        On the Mac: System Settings → Wi-Fi → Details… → IP address. The server listens on port 8000.
      </Text>
      <Pressable onPress={save} disabled={!input.trim() || state.busy} style={[styles.button, !input.trim() && { opacity: 0.4 }]}>
        {state.busy ? <ActivityIndicator color={colors.accentText} /> : <Text style={styles.buttonText}>Save and test</Text>}
      </Pressable>
      {state.message && <Text style={{ color: state.ok ? colors.good : colors.bad, fontSize: 15 }}>{state.message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 12, maxWidth: 560, width: "100%", alignSelf: "center" },
  label: { color: colors.text, fontWeight: "700", fontSize: 16 },
  input: {
    color: colors.text, fontSize: 18, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.card,
  },
  help: { color: colors.muted, fontSize: 14 },
  button: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  buttonText: { color: colors.accentText, fontWeight: "800", fontSize: 17 },
});
