import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { PlaygroundState } from "./types";

export function encodeState(state: PlaygroundState): string {
  return compressToEncodedURIComponent(JSON.stringify(state));
}

export function decodeState(hash: string): PlaygroundState | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  const json = decompressFromEncodedURIComponent(raw);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as PlaygroundState;
  } catch {
    return null;
  }
}
