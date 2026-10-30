import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { Link, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { absolute, health, listCharacters, listJobs, type Character, type Job } from "../lib/api";
import { useSession } from "../lib/session";
import { colors } from "../lib/theme";

export default function Home() {
  const { server, character, photoUri, chooseCharacter, choosePhoto } = useSession();
  const [online, setOnline] = useState<boolean | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);

  const refresh = useCallback(() => {
    if (!server) return;
    health(server)
      .then(() => {
        setOnline(true);
        listCharacters(server).then(setCharacters).catch(() => {});
        listJobs(server).then(setJobs).catch(() => {});
      })
      .catch(() => setOnline(false));
  }, [server]);

  useFocusEffect(
    useCallback(() => {
      refresh();
      const timer = setInterval(refresh, 5000);
      return () => clearInterval(timer);
    }, [refresh]),
  );

  async function pickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.9 });
    if (!result.canceled) choosePhoto(result.assets[0].uri);
  }

  if (!server) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Connect to your Mac</Text>
        <Text style={styles.muted}>
          Moments generates on your own computer. Start the Moments server on your Mac, then enter its address.
        </Text>
        <Link href="/settings" asChild>
          <Pressable style={styles.button}>
            <Text style={styles.buttonText}>Enter server address</Text>
          </Pressable>
        </Link>
      </View>
    );
  }

  const chosen = character !== null || photoUri !== null;
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Link href="/settings" asChild>
        <Pressable style={styles.status}>
          <View style={[styles.dot, { backgroundColor: online ? colors.good : online === false ? colors.bad : colors.muted }]} />
          <Text style={styles.muted}>
            {online ? "Connected to your Mac" : online === false ? "Can't reach your Mac: tap to check" : "Connecting…"}
          </Text>
        </Pressable>
      </Link>

      <Text style={styles.heading}>Who joins your scene?</Text>
      <FlatList
        horizontal
        data={characters}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ gap: 12 }}
        showsHorizontalScrollIndicator={false}
        ListFooterComponent={
          <Pressable onPress={pickPhoto} style={[styles.tile, photoUri ? styles.tileOn : null]}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.tileImage} contentFit="cover" />
            ) : (
              <Text style={[styles.title, { fontSize: 34 }]}>＋</Text>
            )}
            <Text style={styles.tileName}>{photoUri ? "Your photo" : "Use a photo"}</Text>
          </Pressable>
        }
        ListFooterComponentStyle={{ marginLeft: characters.length ? 0 : 0 }}
        renderItem={({ item }) => (
          <Pressable onPress={() => chooseCharacter(item)} style={[styles.tile, character?.id === item.id ? styles.tileOn : null]}>
            <Image source={{ uri: absolute(server, item.image_url) }} style={styles.tileImage} contentFit="contain" />
            <Text style={styles.tileName}>{item.name}</Text>
            <Text style={styles.tileTag} numberOfLines={2}>{item.tagline}</Text>
          </Pressable>
        )}
      />

      <Pressable
        disabled={!chosen || !online}
        onPress={() => router.push("/capture")}
        style={[styles.button, (!chosen || !online) && { opacity: 0.4 }]}
      >
        <Text style={styles.buttonText}>Film a moment</Text>
      </Pressable>
      {!chosen && <Text style={[styles.muted, { textAlign: "center" }]}>Pick a character first.</Text>}

      {jobs.length > 0 && <Text style={styles.heading}>Your moments</Text>}
      {jobs.map((job) => (
        <Pressable key={job.id} onPress={() => router.push(`/job/${job.id}`)} style={styles.row}>
          <Text style={styles.rowTitle} numberOfLines={1}>{job.direction || "Moment"}</Text>
          <Text style={[styles.muted, job.status === "failed" && { color: colors.bad }]}>
            {job.status === "done" ? "Ready" : job.status === "failed" ? "Failed" : job.status === "running"
              ? `Generating ${Math.round(job.progress * 100)}%` : "Waiting"}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 16, maxWidth: 720, width: "100%", alignSelf: "center" },
  center: { flex: 1, justifyContent: "center", padding: 24, gap: 16, maxWidth: 520, alignSelf: "center" },
  title: { color: colors.text, fontSize: 26, fontWeight: "700" },
  heading: { color: colors.text, fontSize: 20, fontWeight: "700", marginTop: 8 },
  muted: { color: colors.muted, fontSize: 15 },
  status: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  tile: {
    width: 132, padding: 10, borderRadius: 16, backgroundColor: colors.card, borderWidth: 2,
    borderColor: "transparent", alignItems: "center", gap: 4,
  },
  tileOn: { borderColor: colors.accent },
  tileImage: { width: 108, height: 130, borderRadius: 10, backgroundColor: "#ffffff", justifyContent: "center" },
  tileName: { color: colors.text, fontWeight: "700", fontSize: 15 },
  tileTag: { color: colors.muted, fontSize: 12, textAlign: "center" },
  button: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  buttonText: { color: colors.accentText, fontWeight: "800", fontSize: 17 },
  row: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12,
    padding: 14, borderRadius: 12, backgroundColor: colors.card,
  },
  rowTitle: { color: colors.text, fontSize: 15, flexShrink: 1 },
});
