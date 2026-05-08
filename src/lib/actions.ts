// High-level action helpers that span stores + Tauri commands.

import { cmd } from "./tauri";
import { basename } from "./paths";
import { confirmAction, showMessage } from "./dialog";
import { useGenerationStore } from "../stores/generationStore";
import { useModelsStore } from "../stores/modelsStore";
import { useSessionStore } from "../stores/sessionStore";
import type {
  ImageMetadata,
  RefImage,
  RefSnapshot,
  RoleAssignment,
} from "./types";

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
  // Metadata stores the combined shot prompt as one string; recall lands it
  // in a single box (the multi-box split is not preserved in metadata).
  gen.setSequencePrompt(meta.sequencePrompt ?? "");
  if (meta.shotPrompts && meta.shotPrompts.length > 0) {
    gen.setShotPrompts(meta.shotPrompts);
  } else {
    gen.setShotPrompts([meta.shotPrompt ?? meta.prompt ?? ""]);
  }

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
  if (meta.shotPrompts && meta.shotPrompts.length > 0) {
    gen.setShotPrompts(meta.shotPrompts);
  } else {
    gen.setShotPrompts([meta.shotPrompt ?? meta.prompt ?? ""]);
  }
}

/** Compute ancestor set for a trace: {image} ∪ {all ancestors via sidecar.refs}. */
export async function computeTraceSet(imagePath: string): Promise<Set<string>> {
  const visited = new Set<string>();
  const queue: string[] = [imagePath];
  while (queue.length) {
    const p = queue.shift()!;
    if (visited.has(p)) continue;
    visited.add(p);
    const meta = (await cmd
      .image_metadata_read(p)
      .catch(() => null)) as ImageMetadata | null;
    if (!meta) continue;
    for (const r of normalizeRefs(meta.refs)) {
      if (!visited.has(r.path)) queue.push(r.path);
    }
  }
  return visited;
}

/** Add a gallery image to the current refs: copy to SRC/ (per current scope) then add (idempotent). */
export async function addImageToRefs(imagePath: string): Promise<string> {
  const { shotPath } = useSessionStore.getState();
  if (!shotPath) throw new Error("no shot open");
  // Skip the copy if the image already lives in any SRC/ folder under the project.
  const normalizedImg = imagePath.replaceAll("\\", "/");
  const alreadyInSrc = normalizedImg.includes("/SRC/");
  let finalPath = imagePath;
  if (!alreadyInSrc) {
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

// ---------- Unified image action dispatcher ----------

export type ImageAction =
  | "zoom"
  | "select"
  | "add_to_refs"
  | "copy_path"
  | "copy_image"
  | "copy_settings"
  | "copy_prompt"
  | "trace"
  | "refresh"
  | "open_location"
  | "delete"
  | "rename"
  | "edit";

const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "mkv", "m4v", "avi"]);

// Transcode an on-disk image to PNG bytes and push to the system clipboard.
// Canvas handles jpeg/webp/etc. so the clipboard receives something every OS
// paste target can accept. Videos aren't supported (no "image" to copy).
async function copyImageToClipboard(path: string): Promise<void> {
  const ext = (path.split(".").pop() ?? "").toLowerCase();
  if (VIDEO_EXTS.has(ext)) {
    await showMessage("Copy image not supported for video files", {
      kind: "warning",
    });
    return;
  }
  try {
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const mime =
      ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : ext === "webp"
          ? "image/webp"
          : "image/png";
    const bytes = await readFile(path);
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const img = new Image();
    img.src = blobUrl;
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("image load failed"));
    });
    URL.revokeObjectURL(blobUrl);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    ctx.drawImage(img, 0, 0);
    const blob: Blob = await new Promise((res, rej) =>
      canvas.toBlob(
        (b) => (b ? res(b) : rej(new Error("toBlob failed"))),
        "image/png",
      ),
    );
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  } catch (e) {
    await showMessage(`Copy image failed: ${e}`, { kind: "error" });
  }
}

/** Single entry point for any image op invoked from thumbs, preview, or zoom. */
export async function performImageAction(
  action: ImageAction,
  path: string,
): Promise<void> {
  const session = useSessionStore.getState();
  switch (action) {
    case "select":
      session.setSelectedImage(path);
      return;
    case "zoom":
      session.setSelectedImage(path);
      session.setZoomImage(path);
      return;
    case "copy_path":
      try {
        await navigator.clipboard.writeText(path);
      } catch {
        /* ignore */
      }
      return;
    case "copy_image":
      await copyImageToClipboard(path);
      return;
    case "add_to_refs":
      try {
        await addImageToRefs(path);
      } catch (e) {
        await showMessage(String(e), { kind: "error" });
      }
      return;
    case "copy_settings": {
      const meta = (await cmd
        .image_metadata_read(path)
        .catch(() => null)) as ImageMetadata | null;
      if (!meta) {
        await showMessage("No metadata for this image", { kind: "warning" });
        return;
      }
      const { skippedRefs } = await copySettingsFromMetadata(meta);
      if (skippedRefs) {
        await showMessage(
          `Loaded. ${skippedRefs} ref(s) skipped (files missing).`,
          {
            kind: "info",
          },
        );
      }
      return;
    }
    case "copy_prompt": {
      const meta = (await cmd
        .image_metadata_read(path)
        .catch(() => null)) as ImageMetadata | null;
      if (!meta) {
        await showMessage("No metadata for this image", { kind: "warning" });
        return;
      }
      const prompt =
        meta.shotPrompt ?? meta.prompt ?? meta.combinedPrompt ?? "";
      try {
        await navigator.clipboard.writeText(prompt);
      } catch {
        /* silent fallback */
      }
      return;
    }
    case "rename":
      session.setRenameImage(path);
      return;
    case "edit":
      session.setSelectedImage(path);
      session.setZoomInitialMode("draw");
      session.setZoomImage(path);
      return;
    case "refresh":
      try {
        await session.rescanShot();
      } catch (e) {
        await showMessage(String(e), { kind: "error" });
      }
      return;
    case "open_location":
      try {
        await cmd.reveal_in_explorer(path);
      } catch (e) {
        await showMessage(String(e), { kind: "error" });
      }
      return;
    case "trace": {
      const t = session.traceActive;
      if (t?.imagePath === path) {
        session.setTrace(null);
        return;
      }
      const set = await computeTraceSet(path);
      session.setTrace({ imagePath: path, traceSet: set });
      return;
    }
    case "delete": {
      const img = session.columns
        .flatMap((c) => c.images)
        .find((i) => i.path === path);
      const ok = await confirmAction(
        `Delete ${img?.filename ?? basename(path)}?`,
        {
          title: "Delete image",
          kind: "warning",
        },
      );
      if (!ok) return;
      try {
        await cmd.image_delete(path);
        await session.rescanShot();
        if (useSessionStore.getState().zoomImagePath === path) {
          useSessionStore.getState().setZoomImage(null);
        }
      } catch (e) {
        await showMessage(String(e), { kind: "error" });
      }
      return;
    }
  }
}

export { basename, type FsExistsLike };
