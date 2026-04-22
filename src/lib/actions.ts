// High-level action helpers that span stores + Tauri commands.

import { cmd } from "./tauri";
import { basename } from "./paths";
import { useGenerationStore } from "../stores/generationStore";
import { useModelsStore } from "../stores/modelsStore";
import { useSessionStore } from "../stores/sessionStore";
import type { ImageMetadata, RefImage, RefSnapshot, RoleAssignment } from "./types";

type FsExistsLike = (path: string) => Promise<boolean>;

async function pathExists(path: string): Promise<boolean> {
  try {
    const { exists } = await import("@tauri-apps/plugin-fs");
    return await exists(path);
  } catch {
    return true;
  }
}

function normalizeRefs(raw: (RefSnapshot | string)[] | undefined): RefImage[] {
  if (!raw) return [];
  return raw.map((r) =>
    typeof r === "string"
      ? { path: r, roleAssignment: null }
      : { path: r.path, roleAssignment: r.roleAssignment ?? null },
  );
}

/** Apply a sidecar metadata record to the current editor state. */
export async function copySettingsFromMetadata(meta: ImageMetadata): Promise<{
  skippedRefs: number;
}> {
  const models = useModelsStore.getState();
  const gen = useGenerationStore.getState();

  const node = models.findById(meta.modelId);
  if (node) gen.selectModel(node);

  // Restore prompts (back-compat: old sidecars only had `prompt`).
  gen.setSequencePrompt(meta.sequencePrompt ?? "");
  gen.setShotPrompt(meta.shotPrompt ?? meta.prompt ?? "");

  // Settings
  const settings = meta.settings || {};
  for (const [k, v] of Object.entries(settings)) gen.setSetting(k, v);

  // Refs — drop any that no longer exist on disk.
  const refs = normalizeRefs(meta.refs);
  const valid: RefImage[] = [];
  let skipped = 0;
  for (const r of refs) {
    if (await pathExists(r.path)) valid.push(r);
    else skipped++;
  }
  useGenerationStore.setState({ refImages: valid });

  if (typeof meta.iterationTotal === "number" && meta.iterationTotal > 0) {
    gen.setIterations(meta.iterationTotal);
  }

  return { skippedRefs: skipped };
}

/** Apply only the prompt fields from a sidecar (shot prompt gets the value). */
export function copyPromptFromMetadata(meta: ImageMetadata): void {
  const gen = useGenerationStore.getState();
  const shot = meta.shotPrompt ?? meta.prompt ?? "";
  gen.setShotPrompt(shot);
}

/** Compute ancestor set for a trace: {image} ∪ {all ancestors via sidecar.refs}. */
export async function computeTraceSet(imagePath: string): Promise<Set<string>> {
  const visited = new Set<string>();
  const queue: string[] = [imagePath];
  while (queue.length) {
    const p = queue.shift()!;
    if (visited.has(p)) continue;
    visited.add(p);
    const meta = (await cmd.image_metadata_read(p).catch(() => null)) as ImageMetadata | null;
    if (!meta) continue;
    for (const r of normalizeRefs(meta.refs)) {
      if (!visited.has(r.path)) queue.push(r.path);
    }
  }
  return visited;
}

/** Add a gallery image to the current refs: copy to <shot>/SRC/ then add (idempotent). */
export async function addImageToRefs(imagePath: string): Promise<string> {
  const { shotPath } = useSessionStore.getState();
  if (!shotPath) throw new Error("no shot open");
  // If the image is already inside SRC/, just add by path.
  const normalizedShot = shotPath.replaceAll("\\", "/");
  const src = `${normalizedShot}/SRC/`;
  const normalizedImg = imagePath.replaceAll("\\", "/");
  let finalPath = imagePath;
  if (!normalizedImg.startsWith(src)) {
    finalPath = await cmd.ref_copy_to_src(shotPath, imagePath);
  }
  useGenerationStore.getState().addRefs([finalPath]);
  return finalPath;
}

export function roleAssignmentLabel(a: RoleAssignment | null): string {
  if (!a) return "";
  if (a.kind === "element") return `@${a.groupName}${a.frontal ? " ★" : ""}`;
  return a.kind;
}

export { basename, type FsExistsLike };
