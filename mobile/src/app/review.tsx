import { Image } from "expo-image";
import { router } from "expo-router";
import { getThumbnailAsync } from "expo-video-thumbnails";
import { useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput,
  useWindowDimensions, View,
} from "react-native";

import { PlacementBox } from "../components/PlacementBox";
import { absolute, createJob } from "../lib/api";
import { DEFAULT_BOX, screenBoxToVideoBox, type Box } from "../lib/placement";
import { useSession } from "../lib/session";
import { colors } from "../lib/theme";

/** Shows the take's first frame: the user adjusts where the character goes and says what happens. */
export default function Review() {
  const { server, character, photoUri, clipUri, standIn } = useSession();
  const [thumb, setThumb] = useState<{ uri: string; width: number; height: number } | null>(null);
  const [box, setBox] = useState<Box>(DEFAULT_BOX);
  const [direction, setDirection] = useState("");
  const [sending, setSending] = useState(false);
  const window = useWindowDimensions();

  useEffect(() => {
    if (!clipUri) return;
    getThumbnailAsync(clipUri, { time: 0 })
      .then((t) => {
        setThumb(t);
        if (standIn) setBox(screenBoxToVideoBox(standIn.box, standIn.screenAspect, t.width / t.height));
      })
      .catch((e) => Alert.alert("Couldn't read the clip", String(e)));
  }, [clipUri, standIn]);

  if (!clipUri || !server) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Nothing filmed yet.</Text>
      </View>
    );
  }

  // Fit the first frame on screen, keeping its shape.
  const aspect = thumb ? thumb.width / thumb.height : 9 / 16;
  const maxW = Math.min(window.width - 40, 640);
  const maxH = window.height * 0.52;
  const frameW = Math.min(maxW, maxH * aspect);
  const frame = { width: frameW, height: frameW / aspect };
  const standInSource = photoUri ? { uri: photoUri } : character ? { uri: absolute(server, character.image_url) } : null;

  async function generate() {
    if (!clipUri || !server) return;
    setSending(true);
    try {
      const choice = photoUri ? { photoUri } : { characterId: character!.id };
      const job = await createJob(server, clipUri, box, choice, direction.trim());
      router.replace(`/job/${job.id}`);
    } catch (e) {
      Alert.alert("Couldn't send to your Mac", e instanceof Error ? e.message : String(e));
      setSending(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text style={styles.muted}>Make the box cover everywhere they’ll move, not just where they start.</Text>
        <View style={[styles.frame, frame]}>
          {thumb ? (
            <Image source={{ uri: thumb.uri }} style={StyleSheet.absoluteFill} contentFit="fill" />
          ) : (
            <ActivityIndicator color={colors.text} style={{ flex: 1 }} />
          )}
          {thumb && (
            <PlacementBox box={box} onChange={setBox} frame={frame}>
              {standInSource && <Image source={standInSource} style={{ flex: 1, opacity: 0.6 }} contentFit="contain" />}
            </PlacementBox>
          )}
        </View>

        <Text style={styles.label}>What should they do or say?</Text>
        <TextInput
          value={direction}
          onChangeText={setDirection}
          placeholder={character?.default_action || "e.g. climbs onto the car and complains about the paint work"}
          placeholderTextColor={colors.muted}
          multiline
          style={styles.input}
        />

        <Pressable onPress={generate} disabled={sending || !thumb} style={[styles.button, (sending || !thumb) && { opacity: 0.5 }]}>
          {sending ? <ActivityIndicator color={colors.accentText} /> : <Text style={styles.buttonText}>Generate</Text>}
        </Pressable>
        <Pressable onPress={() => router.replace("/capture")} disabled={sending}>
          <Text style={[styles.muted, { textAlign: "center" }]}>Film again</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 14, alignItems: "stretch", maxWidth: 680, width: "100%", alignSelf: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  frame: { alignSelf: "center", borderRadius: 12, overflow: "hidden", backgroundColor: "#000" },
  label: { color: colors.text, fontWeight: "700", fontSize: 16, marginTop: 4 },
  muted: { color: colors.muted, fontSize: 15 },
  input: {
    color: colors.text, fontSize: 16, padding: 14, minHeight: 80, borderRadius: 12, borderWidth: 1,
    borderColor: colors.line, backgroundColor: colors.card, textAlignVertical: "top",
  },
  button: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  buttonText: { color: colors.accentText, fontWeight: "800", fontSize: 17 },
});
