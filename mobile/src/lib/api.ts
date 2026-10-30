import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Box } from "./placement";

/** Talks to the Moments server (server/ in this repo), which runs on the user's own computer. */

export type Character = {
  id: string;
  name: string;
  tagline: string;
  default_action: string;
  image_url: string;
};

export type Job = {
  id: string;
  character: string;
  direction: string;
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  error: string | null;
  created: number;
  result_url: string | null;
};

const SERVER_KEY = "moments.server";

export async function getServer(): Promise<string | null> {
  return AsyncStorage.getItem(SERVER_KEY);
}

/** Accepts "192.168.1.20", "192.168.1.20:8000" or a full URL; stores a normalised base URL. */
export async function setServer(input: string): Promise<string> {
  let url = input.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(url)) url = `http://${url}`;
  if (!/:\d+$/.test(url.replace(/^https?:\/\//, ""))) url = `${url}:8000`;
  await AsyncStorage.setItem(SERVER_KEY, url);
  return url;
}

export function absolute(server: string, path: string): string {
  return path.startsWith("http") ? path : `${server}${path}`;
}

async function request<T>(server: string, path: string, init?: RequestInit, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(absolute(server, path), { ...init, signal: controller.signal });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.detail ? String(body.detail) : `Server answered ${res.status}`);
    }
    return (await res.json()) as T;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("The server didn't answer in time.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const health = (server: string) => request<{ ok: boolean; queued: number }>(server, "/health", undefined, 5000);
export const listCharacters = (server: string) => request<Character[]>(server, "/characters");
export const listJobs = (server: string) => request<Job[]>(server, "/jobs");
export const getJob = (server: string, id: string) => request<Job>(server, `/jobs/${id}`);

/** The character is either one of the server's (`characterId`) or a photo from the device (`photoUri`). */
export type CharacterChoice = { characterId: string } | { photoUri: string };

export function createJob(
  server: string,
  clipUri: string,
  placement: Box,
  character: CharacterChoice,
  direction: string,
): Promise<Job> {
  const form = new FormData();
  // React Native's FormData uploads a local file from { uri, name, type }.
  form.append("video", { uri: clipUri, name: "take.mp4", type: "video/mp4" } as unknown as Blob);
  form.append("placement", JSON.stringify(placement));
  form.append("direction", direction);
  if ("characterId" in character) {
    form.append("character_id", character.characterId);
  } else {
    form.append("character_image", { uri: character.photoUri, name: "character.jpg", type: "image/jpeg" } as unknown as Blob);
  }
  // Uploading a clip over Wi-Fi can take a while.
  return request<Job>(server, "/jobs", { method: "POST", body: form }, 120000);
}
