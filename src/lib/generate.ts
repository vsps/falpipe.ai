import { fal } from "@fal-ai/client";
import type { QueueStatus } from "@fal-ai/client";

import { cmd } from "./tauri";
import { basename, joinPath } from "./paths";
import { fileSrc } from "./assets";
import { confirmAction } from "./dialog";
import { pushLog } from "../stores/logStore";
import type {
  Config,
  ImageMetadata,
  ModelNode,
  RefImage,
  RefRoleSpec,
  RoleAssignment,
} from "./types";
import { useGenerationStore } from "../stores/generationStore";
import { useSessionStore } from "../stores/sessionStore";

// ---------- Orchestration entry ----------

let currentController: AbortController | null = null;

type UploadedRef = { ref: RefImage; url: string };

/** Preflight ref-role check. Returns false when the user cancels. */
async function preflightRefs(node: ModelNode, refs: RefImage[]): Promise<boolean> {
  const roles = node.ref_roles ?? [];
  const wantsStart = roles.some((r) => r.role === "start");
  const wantsElement = roles.some((r) => r.role === "element");
  if (!wantsStart && !wantsElement) return true;
  const hasStart = refs.some((r) => r.roleAssignment?.kind === "start");
  const hasElement = refs.some((r) => r.roleAssignment?.kind === "element");
  if (hasStart || hasElement) return true;
  // Auto-element fallback in buildArgs covers this case — unassigned refs
  // on an element-supporting model are promoted to @Element groups at submit.
  if (wantsElement && refs.length > 0) return true;
  const parts: string[] = [];
  if (wantsStart) parts.push("a start frame");
  if (wantsElement) parts.push("element references");
  const needs = parts.join(" and/or ");
  return await confirmAction(
    `No ${needs} assigned. The request will likely fail.\n\nProceed anyway?`,
    { title: "Missing reference role", kind: "warning" },
  );
}

export async function runGeneration(): Promise<void> {
  const gen = useGenerationStore.getState();
  const session = useSessionStore.getState();

  const node = gen.currentModel;
  if (!node) {
    gen.setError("Select a model first.");
    return;
  }
  if (!session.shotPath) {
    gen.setError("Open a shot first.");
    return;
  }
  if (session.targetVersion === "SRC") {
    gen.setError("Target version is SRC — pick an actual version.");
    return;
  }

  const shotCombined = gen.shotPrompts.map((s) => s.trim()).filter((s) => s.length > 0).join("\n\n");
  const combined =
    [gen.sequencePrompt, shotCombined].filter((s) => s.trim().length > 0).join("\n\n");
  if (combined.length === 0) {
    gen.setError("Both prompts are empty.");
    return;
  }

  // Preflight: if the model expects a start frame and/or element references,
  // warn when none of the loaded refs carry either role. Lets the user proceed
  // anyway (some endpoints accept empty refs even if a role is advertised).
  if (!(await preflightRefs(node, gen.refImages))) return;

  const config = (await cmd.config_load().catch(() => null)) as Config | null;
  const testMode = !!config?.testMode && !!config?.testImagePath;
  const ffmpegPath = config?.ffmpegPath ?? "";

  if (!testMode) {
    const falKey = await cmd.fal_key_get().catch(() => "");
    if (!falKey) {
      gen.setError("FAL_KEY not configured — open Settings.");
      return;
    }
    fal.config({ credentials: falKey });
  }

  const controller = new AbortController();
  currentController = controller;

  const generationId = crypto.randomUUID();
  gen.setGenerationId(generationId);
  gen.setGenerating(true);
  gen.setError(null);

  pushLog("INFO", testMode ? "Test-mode generation" : `Generating with ${node.name}`);

  try {
    // Snapshot values at submit time.
    const sequencePrompt = gen.sequencePrompt;
    const shotPrompts = gen.shotPrompts.slice();
    // Combined shot prompt (used for the API call and in image metadata).
    const shotPrompt = shotPrompts.map((s) => s.trim()).filter((s) => s.length > 0).join("\n\n");
    const settings = { ...gen.settings };
    const refs = gen.refImages.slice();
    const iterations = Math.max(1, gen.iterations | 0);

    // 1. Append prompt histories (skip in test mode).
    if (!testMode) {
      if (session.sequencePath && sequencePrompt.length > 0) {
        const sidecar = await cmd.sequence_prompt_append(session.sequencePath, sequencePrompt);
        useSessionStore.getState().hydrateSequenceSidecar(sidecar);
      }
      // Append each non-empty box as its own history entry. Rust dedups against
      // the previous entry, so consecutive identical boxes collapse.
      let lastShotSidecar = null;
      for (const p of shotPrompts) {
        const trimmed = p.trim();
        if (trimmed.length === 0) continue;
        lastShotSidecar = await cmd.shot_prompt_append(session.shotPath, trimmed);
      }
      if (lastShotSidecar) {
        useSessionStore.getState().hydrateShotSidecar(lastShotSidecar);
      }
    }

    if (testMode) {
      await runTestMode({
        iterations,
        shotPath: session.shotPath,
        node,
        sequencePrompt,
        shotPrompt,
        settings,
        refs,
        testImagePath: config!.testImagePath,
        controller,
      });
      if (!controller.signal.aborted) {
        gen.setProgress(`Test-mode generated ${iterations} file(s)`);
        pushLog("SUCCESS", `Test-mode generated ${iterations} file(s)`);
      }
      return;
    }

    // 2. Upload refs once, keyed by path.
    gen.setProgress("Uploading references...");
    const uploaded = await uploadRefs(refs, controller.signal);
    if (controller.signal.aborted) throw new DOMException("aborted", "AbortError");

    // 3. Build base args.
    const baseArgs = buildArgs(node, sequencePrompt, shotPrompt, settings, uploaded);

    // 4. Iteration dispatch.
    const batched = !!node.batch_field && iterations > 1;
    const totalOutputs: string[] = [];

    if (batched) {
      const args = { ...baseArgs, [node.batch_field!]: iterations };
      gen.setProgress("Generating...", 1);
      const res = await subscribeCancelable(
        node.endpoint,
        args,
        (u) => reportQueue(u, 1, iterations),
        controller.signal,
      );
      const { versionDir, targetVersion: tv } = await resolveTargetAtWriteTime(session.shotPath);
      const outs = await downloadAndWrite({
        result: res.data,
        node,
        sequencePrompt,
        shotPrompt,
        settings,
        refs: uploaded,
        versionDir,
        targetVersion: tv,
        iterationBase: 1,
        iterationTotal: iterations,
        expandToIterations: true,
        ffmpegPath,
      });
      totalOutputs.push(...outs);
    } else {
      for (let k = 1; k <= iterations; k++) {
        if (controller.signal.aborted) break;
        gen.setProgress(`Generating (${k}/${iterations})...`, k);
        const res = await subscribeCancelable(
          node.endpoint,
          baseArgs,
          (u) => reportQueue(u, k, iterations),
          controller.signal,
        );
        const { versionDir, targetVersion: tv } = await resolveTargetAtWriteTime(session.shotPath);
        const outs = await downloadAndWrite({
          result: res.data,
          node,
          sequencePrompt,
          shotPrompt,
          settings,
          refs: uploaded,
          versionDir,
          targetVersion: tv,
          iterationBase: k,
          iterationTotal: iterations,
          expandToIterations: false,
          ffmpegPath,
        });
        totalOutputs.push(...outs);
        await useSessionStore.getState().rescanShot();
      }
    }

    if (!controller.signal.aborted) {
      gen.setProgress(`Generated ${totalOutputs.length} file(s)`);
      pushLog("SUCCESS", `Generated ${totalOutputs.length} file(s)`);
      await useSessionStore.getState().rescanShot();
    }
  } catch (e: unknown) {
    const err = e as { name?: string; body?: { detail?: unknown }; message?: string };
    if (err.name === "AbortError" || controller.signal.aborted) {
      gen.setProgress("Cancelled.");
      pushLog("INFO", "Cancelled by user");
    } else {
      const msg = extractErrorMessage(err);
      gen.setError(msg);
      pushLog("ERROR", msg);
    }
  } finally {
    gen.resetRuntime();
    currentController = null;
  }
}

export function cancelGeneration(): void {
  if (currentController) currentController.abort();
}

async function resolveTargetAtWriteTime(
  shotPath: string,
): Promise<{ targetVersion: string; versionDir: string }> {
  let tv = useSessionStore.getState().targetVersion;
  if (!tv || tv === "SRC") {
    tv = await cmd.version_create_next(shotPath);
    useSessionStore.setState({ targetVersion: tv });
  }
  return { targetVersion: tv, versionDir: joinPath(shotPath, tv) };
}

// ---------- Test mode ----------

async function runTestMode(p: {
  iterations: number;
  shotPath: string;
  node: ModelNode;
  sequencePrompt: string;
  shotPrompt: string;
  settings: Record<string, unknown>;
  refs: RefImage[];
  testImagePath: string;
  controller: AbortController;
}) {
  const gen = useGenerationStore.getState();
  for (let k = 1; k <= p.iterations; k++) {
    if (p.controller.signal.aborted) break;
    gen.setProgress(`Test mode (${k}/${p.iterations})...`, k);
    const { versionDir, targetVersion: tv } = await resolveTargetAtWriteTime(p.shotPath);
    const ts = tsNow();
    const filename = `${tv}_${ts}_001.png`;
    const target = joinPath(versionDir, filename);
    const deg = Math.floor(Math.random() * 360);
    await cmd.test_mode_hue_shift(p.testImagePath, target, deg);
    const meta = {
      model: "Test Mode",
      modelId: "test-mode",
      endpoint: "none",
      sequencePrompt: p.sequencePrompt,
      shotPrompt: p.shotPrompt,
      combinedPrompt:
        [p.sequencePrompt, p.shotPrompt]
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .join("\n\n"),
      settings: p.settings,
      refs: p.refs.map((r) => ({ path: r.path, roleAssignment: r.roleAssignment })),
      iterationIndex: k,
      iterationTotal: p.iterations > 1 ? p.iterations : undefined,
      timestamp: new Date().toISOString(),
      falResponse: null,
      hueShift: deg,
      sourceImage: p.testImagePath,
    };
    await cmd.image_metadata_write(target, meta as unknown as ImageMetadata);
    await useSessionStore.getState().rescanShot();
  }
}

// Submit → subscribeToStatus (polling) → result, with server-side cancel on abort.
// Using the queue API rather than fal.subscribe gives us a requestId we can cancel.
async function subscribeCancelable(
  endpoint: string,
  input: Record<string, unknown>,
  onQueueUpdate: (u: QueueStatus) => void,
  signal: AbortSignal,
): Promise<{ data: unknown }> {
  if (signal.aborted) throw new DOMException("aborted", "AbortError");

  const enqueued = await fal.queue.submit(endpoint, { input, abortSignal: signal });
  const requestId = enqueued.request_id;

  // Surface initial queue status (subscribeToStatus may not emit until first poll).
  onQueueUpdate(enqueued);

  // On abort, fire a best-effort server-side cancel. fal may or may not succeed
  // depending on whether the job has started running yet.
  const onAbort = () => {
    void fal.queue.cancel(endpoint, { requestId }).catch(() => {
      /* already running / already cancelled */
    });
  };
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    await fal.queue.subscribeToStatus(endpoint, {
      requestId,
      mode: "polling",
      pollInterval: 1000,
      onQueueUpdate,
      abortSignal: signal,
    });
    const res = await fal.queue.result(endpoint, { requestId, abortSignal: signal });
    return { data: res.data };
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function reportQueue(u: QueueStatus, k: number, total: number) {
  const gen = useGenerationStore.getState();
  const prefix = total > 1 ? `(${k}/${total}) ` : "";
  if (u.status === "IN_QUEUE") {
    gen.setProgress(`${prefix}Queued (pos ${u.queue_position})`, k);
  } else if (u.status === "IN_PROGRESS") {
    gen.setProgress(`${prefix}Generating...`, k);
  } else if (u.status === "COMPLETED") {
    gen.setProgress(`${prefix}Downloading...`, k);
  }
}

async function uploadRefs(refs: RefImage[], signal: AbortSignal): Promise<UploadedRef[]> {
  const out: UploadedRef[] = [];
  for (const r of refs) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    const blob = await fetch(fileSrc(r.path)).then((x) => x.blob());
    const name = basename(r.path);
    const type = blob.type || guessContentType(name);
    const file = new File([blob], name, { type });
    const url = await fal.storage.upload(file);
    out.push({ ref: r, url });
  }
  return out;
}

function guessContentType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    mp4: "video/mp4",
    webm: "video/webm",
  };
  return map[ext ?? ""] ?? "application/octet-stream";
}

export function buildArgs(
  node: ModelNode,
  sequencePrompt: string,
  shotPrompt: string,
  settings: Record<string, unknown>,
  uploaded: UploadedRef[],
): Record<string, unknown> {
  const args: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(settings)) {
    if (k === "seed" && v === -1) continue;
    args[k] = v;
  }

  const combined = [sequencePrompt, shotPrompt]
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join("\n\n");
  if (combined.length > 0) args["prompt"] = combined;

  if (node.ref_roles && node.ref_roles.length > 0) {
    const bucket: Record<string, UploadedRef[]> = {};
    const unassigned: UploadedRef[] = [];
    for (const r of uploaded) {
      const a = r.ref.roleAssignment;
      if (!a) {
        unassigned.push(r);
        continue;
      }
      const key = a.kind === "element" ? `element:${a.groupName}` : a.kind;
      (bucket[key] ??= []).push(r);
    }

    // Auto-element fallback: if the model supports "element" AND the user
    // assigned no roles to anything, promote each unassigned ref to its own
    // element group. Lets Kling 3 ref2vid accept "just these images" without
    // forcing a role click for every thumb.
    const hasElementRole = node.ref_roles.some((r) => r.role === "element");
    if (
      hasElementRole &&
      Object.keys(bucket).length === 0 &&
      unassigned.length > 0
    ) {
      unassigned.forEach((u, i) => {
        bucket[`element:${i + 1}`] = [u];
      });
      unassigned.length = 0;
    }

    let sourceConsumed = false;
    for (const role of node.ref_roles) {
      if (role.role === "element") {
        const elements = buildElements(bucket, role.max);
        if (elements.length > 0) args[role.api_field] = elements;
        continue;
      }
      const slice = selectForRole(role, bucket, unassigned, sourceConsumed);
      if (slice.length === 0) continue;
      if (role.role === "source") sourceConsumed = true;
      const urls = slice.map((s) => s.url);
      const isScalar = urls.length === 1 && (role.max === 1 || role.exclusive);
      args[role.api_field] = isScalar ? urls[0] : urls;
    }
  } else if (uploaded.length > 0) {
    args["image_urls"] = uploaded.map((u) => u.url);
  }

  for (const input of node.inputs) {
    if (input.api_format === "array" && input.api_field in args) {
      const v = args[input.api_field];
      if (!Array.isArray(v)) args[input.api_field] = [v];
    }
  }

  return args;
}

function selectForRole(
  role: RefRoleSpec,
  bucket: Record<string, UploadedRef[]>,
  unassigned: UploadedRef[],
  sourceConsumed: boolean,
): UploadedRef[] {
  if (role.exclusive) {
    return (bucket[role.role] ?? []).slice(0, 1);
  }
  let picked = bucket[role.role] ?? [];
  if (picked.length === 0 && role.role === "source" && !sourceConsumed) {
    picked = unassigned;
  }
  return role.max ? picked.slice(0, role.max) : picked;
}

type KlingElement = {
  frontal_image_url: string;
  reference_image_urls: string[];
};

// Emit Kling-shaped elements[] — one entry per element:<groupName> bucket,
// ordered by numeric groupName (user-assigned; gaps collapse at emission time
// since Kling references elements positionally as @Element1..N).
// Each element must have BOTH frontal_image_url and reference_image_urls per
// Kling's schema. If a group has only one image, the frontal is duplicated
// into the refs list. If no image is explicitly frontal (should be rare —
// the store auto-promotes the first), we promote the first here too.
function buildElements(
  bucket: Record<string, UploadedRef[]>,
  max?: number,
): KlingElement[] {
  const keys = Object.keys(bucket)
    .filter((k) => k.startsWith("element:"))
    .sort((a, b) => {
      const na = Number(a.slice(8));
      const nb = Number(b.slice(8));
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return a.localeCompare(b);
    });

  const out: KlingElement[] = [];
  for (const key of keys) {
    const refs = bucket[key];
    if (refs.length === 0) continue;

    let frontal: string | undefined;
    const rest: string[] = [];
    for (const r of refs) {
      const a = r.ref.roleAssignment;
      if (a?.kind === "element" && a.frontal && !frontal) frontal = r.url;
      else rest.push(r.url);
    }
    if (!frontal) {
      frontal = refs[0].url;
      rest.shift();
    }
    out.push({
      frontal_image_url: frontal,
      reference_image_urls: rest.length > 0 ? rest : [frontal],
    });
  }
  return max ? out.slice(0, max) : out;
}

// ---------- Download + sidecar ----------

type DownloadCtx = {
  result: unknown;
  node: ModelNode;
  sequencePrompt: string;
  shotPrompt: string;
  settings: Record<string, unknown>;
  refs: UploadedRef[];
  versionDir: string;
  targetVersion: string;
  iterationBase: number;
  iterationTotal: number;
  expandToIterations: boolean;
  ffmpegPath: string;
};

async function downloadAndWrite(ctx: DownloadCtx): Promise<string[]> {
  const r = ctx.result as Record<string, unknown>;
  const written: string[] = [];
  const ts = tsNow();

  const video = r["video"] as { url?: string } | undefined;
  if (video && typeof video.url === "string") {
    const ext = extFromUrl(video.url) ?? "mp4";
    const filename = `${ctx.targetVersion}_${ts}_001.${ext}`;
    const target = joinPath(ctx.versionDir, filename);
    await cmd.download_to_path(video.url, target);
    const thumbPath = target.replace(/\.[^.]+$/, ".thumb.png");
    if (ctx.ffmpegPath) {
      await cmd.video_thumbnail_extract(target, thumbPath, ctx.ffmpegPath).catch(() => false);
    }
    const meta = buildMetadataRecord(ctx, video, ctx.iterationBase);
    await cmd.image_metadata_write(target, meta as unknown as ImageMetadata);
    written.push(target);
    return written;
  }

  const imagesField = r["images"];
  const single = r["image"] as { url?: string } | undefined;
  const images: { url?: string }[] = Array.isArray(imagesField)
    ? (imagesField as { url?: string }[])
    : single && typeof single.url === "string"
    ? [single]
    : [];

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (!img?.url) continue;
    const declaredExt = String(ctx.settings["output_format"] ?? "").toLowerCase();
    const ext = declaredExt || extFromUrl(img.url) || "png";
    const idx = i + 1;
    const filename = `${ctx.targetVersion}_${ts}_${String(idx).padStart(3, "0")}.${ext}`;
    const target = joinPath(ctx.versionDir, filename);
    await cmd.download_to_path(img.url, target);
    const iterIdx = ctx.expandToIterations
      ? Math.min(ctx.iterationBase + i, ctx.iterationTotal)
      : ctx.iterationBase;
    const meta = buildMetadataRecord(ctx, img, iterIdx);
    await cmd.image_metadata_write(target, meta as unknown as ImageMetadata);
    written.push(target);
  }
  return written;
}

function buildMetadataRecord(ctx: DownloadCtx, falResponse: unknown, iterationIndex: number) {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx.settings)) {
    if (k === "seed" && v === -1) continue;
    if (ctx.node.batch_field && k === ctx.node.batch_field) continue;
    cleaned[k] = v;
  }
  const combined =
    [ctx.sequencePrompt, ctx.shotPrompt]
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .join("\n\n");
  return {
    model: ctx.node.name,
    modelId: ctx.node.id,
    endpoint: ctx.node.endpoint,
    sequencePrompt: ctx.sequencePrompt,
    shotPrompt: ctx.shotPrompt,
    combinedPrompt: combined,
    settings: cleaned,
    refs: ctx.refs.map((r) => ({
      path: r.ref.path,
      roleAssignment: r.ref.roleAssignment as RoleAssignment | null,
    })),
    iterationIndex,
    iterationTotal: ctx.iterationTotal > 1 ? ctx.iterationTotal : undefined,
    timestamp: new Date().toISOString(),
    falResponse,
  };
}

function tsNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}` +
    `${p(d.getMonth() + 1)}` +
    `${p(d.getDate())}` +
    `_${p(d.getHours())}` +
    `${p(d.getMinutes())}` +
    `${p(d.getSeconds())}`
  );
}

function extFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\.([a-zA-Z0-9]{2,5})(?:$|\?)/);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

function extractErrorMessage(err: {
  body?: { detail?: unknown };
  message?: string;
}): string {
  if (err?.body?.detail !== undefined) {
    return typeof err.body.detail === "string"
      ? err.body.detail
      : JSON.stringify(err.body.detail, null, 2);
  }
  if (err?.message) return err.message;
  return String(err);
}
