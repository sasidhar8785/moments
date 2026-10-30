import { File, Paths } from "expo-file-system";
import { Asset, requestPermissionsAsync } from "expo-media-library";
import { router, useLocalSearchParams } from "expo-router";
import { shareAsync } from "expo-sharing";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { absolute, getJob, type Job } from "../../lib/api";
import { useSession } from "../../lib/session";
import { colors } from "../../lib/theme";

export default function JobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { server } = useSession();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!server || !id) return;
    let stopped = false;
    const poll = async () => {
      try {
        const latest = await getJob(server, id);
        if (stopped) return;
        setJob(latest);
        setError(null);
        if (latest.status === "done" || latest.status === "failed") return;
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : String(e));
      }
      if (!stopped) setTimeout(poll, 2000);
    };
    poll();
    return () => {
      stopped = true;
    };
  }, [server, id]);

  if (!job) {
    return (
      <View style={styles.center}>
        {error ? <Text style={styles.bad}>{error}</Text> : <ActivityIndicator color={colors.text} />}
      </View>
    );
  }

  if (job.status === "failed") {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>That one didn’t work</Text>
        <Text style={styles.muted}>{job.error}</Text>
        <Pressable style={styles.button} onPress={() => router.replace("/capture")}>
          <Text style={styles.buttonText}>Film again</Text>
        </Pressable>
      </View>
    );
  }

  if (job.status !== "done" || !job.result_url || !server) {
    const percent = Math.round(job.progress * 100);
    return (
      <View style={styles.center}>
        <Text style={styles.title}>{job.status === "queued" ? "Waiting for your Mac…" : "Generating your moment…"}</Text>
        <View style={styles.track}>
          <View style={[styles.fillBar, { width: `${Math.max(percent, 3)}%` }]} />
        </View>
        <Text style={styles.muted}>
          {job.status === "running" ? `${percent}%` : "Another moment is still generating."} This takes several minutes. You
          can leave this screen; it’ll be under Your moments.
        </Text>
        {error && <Text style={styles.bad}>{error}</Text>}
        <Pressable onPress={() => router.dismissTo("/")}>
          <Text style={[styles.muted, { textDecorationLine: "underline" }]}>Back to home</Text>
        </Pressable>
      </View>
    );
  }

  return <Result url={absolute(server, job.result_url)} jobId={job.id} />;
}

function Result({ url, jobId }: { url: string; jobId: string }) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.play();
  });
  const [busy, setBusy] = useState<"save" | "share" | null>(null);

  async function download(): Promise<File> {
    const file = new File(Paths.cache, `moment-${jobId}.mp4`);
    if (file.exists) return file;
    return File.downloadFileAsync(url, file);
  }

  async function save() {
    setBusy("save");
    try {
      const permission = await requestPermissionsAsync(true);
      if (!permission.granted) throw new Error("Allow Moments to add to your Photos in Settings.");
      await Asset.create((await download()).uri);
      Alert.alert("Saved", "Your moment is in Photos.");
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function share() {
    setBusy("share");
    try {
      await shareAsync((await download()).uri, { mimeType: "video/mp4", UTI: "public.mpeg-4" });
    } catch (e) {
      Alert.alert("Couldn't share", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <VideoView player={player} style={styles.video} nativeControls contentFit="contain" />
      <View style={styles.actions}>
        <Pressable style={[styles.button, { flex: 1 }]} onPress={save} disabled={busy !== null}>
          {busy === "save" ? <ActivityIndicator color={colors.accentText} /> : <Text style={styles.buttonText}>Save to Photos</Text>}
        </Pressable>
        <Pressable style={[styles.button, styles.secondary, { flex: 1 }]} onPress={share} disabled={busy !== null}>
          {busy === "share" ? <ActivityIndicator color={colors.text} /> : <Text style={[styles.buttonText, { color: colors.text }]}>Share</Text>}
        </Pressable>
      </View>
      <Pressable onPress={() => router.replace("/capture")}>
        <Text style={[styles.muted, { textAlign: "center" }]}>Film another</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 14, maxWidth: 680, width: "100%", alignSelf: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16, maxWidth: 560, alignSelf: "center" },
  title: { color: colors.text, fontSize: 22, fontWeight: "700", textAlign: "center" },
  muted: { color: colors.muted, fontSize: 15, textAlign: "center" },
  bad: { color: colors.bad, fontSize: 15, textAlign: "center" },
  track: { height: 10, alignSelf: "stretch", borderRadius: 5, backgroundColor: colors.card, overflow: "hidden" },
  fillBar: { height: "100%", backgroundColor: colors.accent },
  video: { width: "100%", aspectRatio: 9 / 16, maxHeight: 640, borderRadius: 12, backgroundColor: "#000" },
  actions: { flexDirection: "row", gap: 12 },
  button: { backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 16, alignItems: "center" },
  secondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  buttonText: { color: colors.accentText, fontWeight: "800", fontSize: 17 },
});
