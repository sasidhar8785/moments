import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PlacementBox } from "../components/PlacementBox";
import { absolute } from "../lib/api";
import type { Box } from "../lib/placement";
import { useSession } from "../lib/session";
import { colors } from "../lib/theme";

/** The model uses up to 5 seconds; a little extra gives room to trim. */
const MAX_SECONDS = 6;

export default function Capture() {
  const { server, character, photoUri, setTake } = useSession();
  const [cameraPermission, requestCamera] = useCameraPermissions();
  const [micPermission, requestMic] = useMicrophonePermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [box, setBox] = useState<Box>({ left: 0.3, top: 0.4, width: 0.4, height: 0.4 });
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (cameraPermission && !cameraPermission.granted && cameraPermission.canAskAgain) requestCamera();
    else if (cameraPermission?.granted && micPermission && !micPermission.granted && micPermission.canAskAgain) requestMic();
  }, [cameraPermission, micPermission, requestCamera, requestMic]);

  if (!cameraPermission || !micPermission) return <View style={styles.fill} />;
  if (!cameraPermission.granted || !micPermission.granted) {
    return (
      <View style={[styles.fill, styles.center]}>
        <Text style={styles.message}>Moments needs the camera and microphone to film your scene.</Text>
        <Pressable style={styles.pill} onPress={() => (cameraPermission.granted ? requestMic() : requestCamera())}>
          <Text style={styles.pillText}>Allow access</Text>
        </Pressable>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.message}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const standIn = photoUri ? { uri: photoUri } : character && server ? { uri: absolute(server, character.image_url) } : null;

  async function toggleRecording() {
    if (recording) {
      camera.current?.stopRecording();
      return;
    }
    setRecording(true);
    const started = Date.now();
    const timer = setInterval(() => setElapsed((Date.now() - started) / 1000), 200);
    try {
      const result = await camera.current?.recordAsync({ maxDuration: MAX_SECONDS });
      const seconds = (Date.now() - started) / 1000;
      if (!result?.uri) return;
      if (seconds < 1) {
        Alert.alert("Too short", "Film at least a second or two (3–5 seconds works best).");
        return;
      }
      setTake(result.uri, { box, screenAspect: window.width / window.height });
      router.replace("/review");
    } catch (e) {
      Alert.alert("Recording failed", e instanceof Error ? e.message : String(e));
    } finally {
      clearInterval(timer);
      setRecording(false);
      setElapsed(0);
    }
  }

  return (
    <View style={styles.fill}>
      <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" mode="video" onCameraReady={() => setReady(true)} />

      {/* The stand-in shows where the character will be; it is not part of the recording. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <PlacementBox box={box} onChange={setBox} frame={window}>
          {standIn && <Image source={standIn} style={styles.standIn} contentFit="contain" />}
        </PlacementBox>
      </View>

      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <Pressable onPress={() => router.back()} style={styles.pill} disabled={recording}>
          <Text style={styles.pillText}>✕</Text>
        </Pressable>
        <Text style={styles.hint}>
          {recording
            ? `Recording ${elapsed.toFixed(0)}s / ${MAX_SECONDS}s: act with them`
            : "Drag the box to where they stand, then record 3–5 seconds of you reacting to them"}
        </Text>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 24 }]}>
        <Pressable onPress={toggleRecording} disabled={!ready} style={[styles.record, !ready && { opacity: 0.4 }]}>
          <View style={[styles.recordInner, recording && styles.recordStop]} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "#000" },
  center: { alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  message: { color: colors.text, fontSize: 16, textAlign: "center" },
  standIn: { flex: 1, opacity: 0.55 },
  top: { position: "absolute", left: 0, right: 0, top: 0, paddingHorizontal: 16, gap: 10, alignItems: "flex-start" },
  hint: {
    color: "#fff", fontSize: 15, backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 12, overflow: "hidden", alignSelf: "stretch", textAlign: "center",
  },
  pill: { backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  pillText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center" },
  record: { width: 82, height: 82, borderRadius: 41, borderWidth: 5, borderColor: "#fff", alignItems: "center", justifyContent: "center" },
  recordInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: "#ff3b30" },
  recordStop: { width: 30, height: 30, borderRadius: 6 },
});
