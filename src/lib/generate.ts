import { cmd } from "./tauri";
import { basename, joinPath } from "./paths";
import { fileSrc } from "./assets";
import { confirmAction } from "./dialog";
import { pushLog } from "../stores/logStore";
import type {
  Config,
  ImageMetadata,
  Job,
  ModelNode,
  RefImage,
  RefRoleSpec,
  RoleAssignment,
} from "./types";
import { useGenerationStore } from "../stores/generationStore";
import { useSessionStore } from "../stores/sessionStore";
import { getProvider } from "./providers";
import type { ProviderOutput, ProviderProgress } from "./providers";

// ---------- Orchestration entry ----------

// Per-job AbortController. Keyed by job id so cancellation can target one or all.
const abortControllers = new Map<string, AbortController>();

// Snapshotted spec per queued job. Held outside the store because the runtime
// payload (model node, ref roles, ffmpeg path, …) is heavier than what the UI
// needs to render and would bloat the persisted store shape.
const jobSpecs = new Map<string, JobSpec>();

// Cached at queue-pump time. Reads Config asynchronously, so we keep a value
// to use synchronously inside the pump loop. Default 3 matches the schema.
let cachedMaxConcurrent = 3;

// Reentrancy guard for pumpQueue. The pump itself is async because it calls
// runJob; without this flag, two enqueues could race and over-dispatch.
let pumping = false;

type UploadedRef = { ref: RefImage; url: string };

type JobSpec = {
  id: string;
  tag: string; // short id for log lines
  node: ModelNode;
  sequencePrompt: string;
  shotPrompts: string[];
  shotPrompt: string; // combined; used for API + metadata
  settings: Record<string, unknown>;
  refs: RefImage[];
  iterations: number;
  shotPath: string;
  targetVersion: string;
  testMode: boolean;
  testImagePath: string;
  ffmpegPath: string;
};

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

/**
 * Snapshot the current generation form into a Job + JobSpec, push the job onto
 * the queue, and kick the dispatcher. Multiple calls accumulate; the pump
 * respects `Config.maxConcurrentJobs` and the rest sit at status:queued.
 */
export async function enqueueGeneration(): Promise<void> {
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

  if (!(await preflightRefs(node, gen.refImages))) return;

  const config = (await cmd.config_load().catch(() => null)) as Config | null;
  const testMode = !!config?.testMode && !!config?.testImagePath;
  const ffmpegPath = config?.ffmpegPath ?? "";
  cachedMaxConcurrent = Math.max(1, config?.maxConcurrentJobs ?? 3);

  if (!testMode) {
    try {
      await getProvider(node.provider).prepare();
    } catch (e) {
      gen.setError(e instanceof Error ? e.message : String(e));
      return;
    }
  }

  // Resolve target version up front so the job is bound to a concrete (shot,
  // version) at submit time even if the user navigates away mid-flight.
  let targetVersion = session.targetVersion;
  if (!targetVersion || targetVersion === "SRC") {
    targetVersion = await cmd.version_create_next(session.shotPath);
    useSessionStore.setState({ targetVersion });
  }

  const id = crypto.randomUUID();
  const tag = id.slice(0, 6);
  const shotPrompts = gen.shotPrompts.slice();
  const shotPrompt = shotPrompts.map((s) => s.trim()).filter((s) => s.length > 0).join("\n\n");
  const iterations = Math.max(1, gen.iterations | 0);

  const spec: JobSpec = {
    id,
    tag,
    node,
    sequencePrompt: gen.sequencePrompt,
    shotPrompts,
    shotPrompt,
    settings: { ...gen.settings },
    refs: gen.refImages.slice(),
    iterations,
    shotPath: session.shotPath,
    targetVersion,
    testMode,
    testImagePath: config?.testImagePath ?? "",
    ffmpegPath,
  };
  jobSpecs.set(id, spec);

  const job: Job = {
    id,
    status: "queued",
    progressMessage: "Queued",
    currentIteration: 0,
    iterations,
    modelName: node.name,
    shotPath: session.shotPath,
    targetVersion,
    startedAt: performance.now(),
  };
  gen.addJob(job);
  gen.setError(null);

  pushLog("INFO", testMode ? "Test-mode generation queued" : `Queued: ${node.name}`, tag);

  // Append prompt histories synchronously at submit time so the navigation UI
  // reflects the latest prompts even before the job is dispatched.
  if (!testMode) {
    if (session.sequencePath && spec.sequencePrompt.length > 0) {
      try {
        const sidecar = await cmd.sequence_prompt_append(session.sequencePath, spec.sequencePrompt);
        useSessionStore.getState().hydrateSequenceSidecar(sidecar);
      } catch {
        /* swallow — history append failures are non-fatal */
      }
    }
    let lastShotSidecar = null;
    for (const p of spec.shotPrompts) {
      const trimmed = p.trim();
      if (trimmed.length === 0) continue;
      try {
        lastShotSidecar = await cmd.shot_prompt_append(spec.shotPath, trimmed);
      } catch {
        /* swallow */
      }
    }
    if (lastShotSidecar) {
      useSessionStore.getState().hydrateShotSidecar(lastShotSidecar);
    }
  }

  void pumpQueue();
}

function activeJobCount(): number {
  return useGenerationStore.getState().jobs.filter((j) => {
    return (
      j.status !== "queued" &&
      j.status !== "done" &&
      j.status !== "failed" &&
      j.status !== "cancelled"
    );
  }).length;
}

/**
 * Dispatcher. Picks the next queued job whenever an in-flight slot is free.
 * Reentrancy-guarded: a single loop drains the queue up to the cap, then
 * exits. Called from enqueueGeneration and from each job's finally.
 */
async function pumpQueue(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (true) {
      const state = useGenerationStore.getState();
      const queued = state.jobs.find((j) => j.status === "queued");
      if (!queued) break;
      if (activeJobCount() >= cachedMaxConcurrent) break;

      const spec = jobSpecs.get(queued.id);
      if (!spec) {
        // Defensive: drop a queued job with no spec rather than spinning.
        state.removeJob(queued.id);
        continue;
      }
      // Fire-and-forget. runJob calls pumpQueue itself in finally, which is a
      // no-op while we're still inside this loop (pumping=true).
      void runJob(spec);
    }
  } finally {
    pumping = false;
  }
}

/** Cancel every queued and running job, plus best-effort server-side cancel. */
export function cancelAllGenerations(): void {
  const state = useGenerationStore.getState();
  for (const j of state.jobs) {
    if (j.status === "done" || j.status === "failed" || j.status === "cancelled") continue;
    if (j.status === "queued") {
      jobSpecs.delete(j.id);
      state.updateJob(j.id, { status: "cancelled", progressMessage: "Cancelled" });
      schedulePrune(j.id);
      pushLog("INFO", "Cancelled (was queued)", j.id.slice(0, 6));
      continue;
    }
    state.updateJob(j.id, { status: "cancelling", progressMessage: "Cancelling…" });
    abortControllers.get(j.id)?.abort();
  }
}

function schedulePrune(jobId: string, delayMs = 5000): void {
  setTimeout(() => {
    useGenerationStore.getState().removeJob(jobId);
    jobSpecs.delete(jobId);
  }, delayMs);
}

/** Runs one job to completion / cancellation / failure. */
async function runJob(spec: JobSpec): Promise<void> {
  const gen = useGenerationStore.getState();
  const tag = spec.tag;

  const controller = new AbortController();
  abortControllers.set(spec.id, controller);

  gen.updateJob(spec.id, { status: "uploading", progressMessage: "Uploading references…" });
  pushLog("INFO", spec.testMode ? "Test-mode start" : `Generating with ${spec.node.name}`, tag);

  try {
    if (spec.testMode) {
      await runTestMode(spec, controller);
      if (!controller.signal.aborted) {
        gen.updateJob(spec.id, {
          status: "done",
          progressMessage: `Test-mode generated ${spec.iterations} file(s)`,
        });
        pushLog("SUCCESS", `Test-mode generated ${spec.iterations} file(s)`, tag);
      }
      return;
    }

    const provider = getProvider(spec.node.provider);
    await provider.prepare();

    const uploaded = await uploadRefs(provider, spec.refs, controller.signal);
    if (controller.signal.aborted) throw new DOMException("aborted", "AbortError");

    const baseArgs = buildArgs(spec.node, spec.sequencePrompt, spec.shotPrompt, spec.settings, uploaded);
    const versionDir = joinPath(spec.shotPath, spec.targetVersion);

    const batched = !!spec.node.batch_field && spec.iterations > 1;
    const totalOutputs: string[] = [];

    gen.updateJob(spec.id, { status: "running" });

    if (batched) {
      const args = { ...baseArgs, [spec.node.batch_field!]: spec.iterations };
      reportProgress(spec.id, 1, spec.iterations, { kind: "running" });
      const out = await provider.run(
        spec.node.endpoint,
        args,
        controller.signal,
        (e) => reportProgress(spec.id, 1, spec.iterations, e),
      );
      gen.updateJob(spec.id, { status: "downloading", progressMessage: "Downloading…" });
      const outs = await downloadAndWrite({
        out,
        node: spec.node,
        sequencePrompt: spec.sequencePrompt,
        shotPrompt: spec.shotPrompt,
        settings: spec.settings,
        refs: uploaded,
        versionDir,
        targetVersion: spec.targetVersion,
        iterationBase: 1,
        iterationTotal: spec.iterations,
        expandToIterations: true,
        ffmpegPath: spec.ffmpegPath,
      });
      totalOutputs.push(...outs);
    } else {
      for (let k = 1; k <= spec.iterations; k++) {
        if (controller.signal.aborted) break;
        gen.updateJob(spec.id, {
          status: "running",
          currentIteration: k,
          progressMessage: `Generating (${k}/${spec.iterations})…`,
        });
        const out = await provider.run(
          spec.node.endpoint,
          baseArgs,
          controller.signal,
          (e) => reportProgress(spec.id, k, spec.iterations, e),
        );
        gen.updateJob(spec.id, { status: "downloading", progressMessage: `Downloading (${k}/${spec.iterations})…` });
        const outs = await downloadAndWrite({
          out,
          node: spec.node,
          sequencePrompt: spec.sequencePrompt,
          shotPrompt: spec.shotPrompt,
          settings: spec.settings,
          refs: uploaded,
          versionDir,
          targetVersion: spec.targetVersion,
          iterationBase: k,
          iterationTotal: spec.iterations,
          expandToIterations: false,
          ffmpegPath: spec.ffmpegPath,
        });
        totalOutputs.push(...outs);
        // Rescan only when the freshly-written shot is what the user is viewing;
        // otherwise the gallery would briefly flicker to the job's shot.
        if (useSessionStore.getState().shotPath === spec.shotPath) {
          await useSessionStore.getState().rescanShot();
        }
      }
    }

    if (!controller.signal.aborted) {
      gen.updateJob(spec.id, {
        status: "done",
        progressMessage: `Generated ${totalOutputs.length} file(s)`,
      });
      pushLog("SUCCESS", `Generated ${totalOutputs.length} file(s)`, tag);
      if (useSessionStore.getState().shotPath === spec.shotPath) {
        await useSessionStore.getState().rescanShot();
      }
    }
  } catch (e: unknown) {
    const err = e as { name?: string };
    if (err.name === "AbortError" || controller.signal.aborted) {
      gen.updateJob(spec.id, { status: "cancelled", progressMessage: "Cancelled" });
      pushLog("INFO", "Cancelled by user", tag);
    } else {
      // Always dump the raw error so dev tools shows every field — wrappers
      // around fetch/SDK errors otherwise lose status/body when stringified.
      console.error(`[job ${tag}] failed:`, e);
      const msg = extractErrorMessage(e);
      gen.updateJob(spec.id, { status: "failed", progressMessage: "Failed", error: msg });
      gen.setError(msg);
      pushLog("ERROR", msg, tag);
    }
  } finally {
    abortControllers.delete(spec.id);
    jobSpecs.delete(spec.id);
    schedulePrune(spec.id);
    void pumpQueue();
  }
}

// ---------- Test mode ----------

async function runTestMode(spec: JobSpec, controller: AbortController) {
  const gen = useGenerationStore.getState();
  const versionDir = joinPath(spec.shotPath, spec.targetVersion);
  for (let k = 1; k <= spec.iterations; k++) {
    if (controller.signal.aborted) break;
    gen.updateJob(spec.id, {
      status: "running",
      currentIteration: k,
      progressMessage: `Test mode (${k}/${spec.iterations})…`,
    });
    const ts = tsNow();
    const filename = `${spec.targetVersion}_${ts}_001.png`;
    const target = joinPath(versionDir, filename);
    const deg = Math.floor(Math.random() * 360);
    await cmd.test_mode_hue_shift(spec.testImagePath, target, deg);
    const meta = {
      model: "Test Mode",
      modelId: "test-mode",
      endpoint: "none",
      sequencePrompt: spec.sequencePrompt,
      shotPrompt: spec.shotPrompt,
      combinedPrompt:
        [spec.sequencePrompt, spec.shotPrompt]
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .join("\n\n"),
      settings: spec.settings,
      refs: spec.refs.map((r) => ({ path: r.path, roleAssignment: r.roleAssignment })),
      iterationIndex: k,
      iterationTotal: spec.iterations > 1 ? spec.iterations : undefined,
      timestamp: new Date().toISOString(),
      providerResponse: null,
      hueShift: deg,
      sourceImage: spec.testImagePath,
    };
    await cmd.image_metadata_write(target, meta as unknown as ImageMetadata);
    if (useSessionStore.getState().shotPath === spec.shotPath) {
      await useSessionStore.getState().rescanShot();
    }
  }
}

function reportProgress(jobId: string, k: number, total: number, e: ProviderProgress) {
  const gen = useGenerationStore.getState();
  const prefix = total > 1 ? `(${k}/${total}) ` : "";
  if (e.kind === "queued") {
    const pos = e.position !== undefined ? ` (pos ${e.position})` : "";
    gen.updateJob(jobId, {
      currentIteration: k,
      progressMessage: `${prefix}Queued at provider${pos}`,
    });
  } else if (e.kind === "running") {
    gen.updateJob(jobId, {
      currentIteration: k,
      progressMessage: `${prefix}Generating…`,
    });
  } else if (e.kind === "completed") {
    gen.updateJob(jobId, {
      currentIteration: k,
      progressMessage: `${prefix}Downloading…`,
    });
  }
}

async function uploadRefs(
  provider: { uploadFile: (file: File, signal: AbortSignal) => Promise<string> },
  refs: RefImage[],
  signal: AbortSignal,
): Promise<UploadedRef[]> {
  const out: UploadedRef[] = [];
  for (const r of refs) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    const blob = await fetch(fileSrc(r.path)).then((x) => x.blob());
    const name = basename(r.path);
    const type = blob.type || guessContentType(name);
    const file = new File([blob], name, { type });
    const url = await provider.uploadFile(file, signal);
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
  out: ProviderOutput;
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
  const written: string[] = [];
  const ts = tsNow();
  const files = ctx.out.files;

  const firstVideo = files.find((f) => f.isVideo);
  if (firstVideo) {
    const ext = extFromUrl(firstVideo.url) ?? "mp4";
    const filename = `${ctx.targetVersion}_${ts}_001.${ext}`;
    const target = joinPath(ctx.versionDir, filename);
    await cmd.download_to_path(firstVideo.url, target);
    const thumbPath = target.replace(/\.[^.]+$/, ".thumb.png");
    if (ctx.ffmpegPath) {
      await cmd.video_thumbnail_extract(target, thumbPath, ctx.ffmpegPath).catch(() => false);
    }
    const meta = buildMetadataRecord(ctx, ctx.iterationBase);
    await cmd.image_metadata_write(target, meta as unknown as ImageMetadata);
    written.push(target);
    return written;
  }

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!f.url) continue;
    const declaredExt = String(ctx.settings["output_format"] ?? "").toLowerCase();
    const ext = declaredExt || extFromUrl(f.url) || "png";
    const idx = i + 1;
    const filename = `${ctx.targetVersion}_${ts}_${String(idx).padStart(3, "0")}.${ext}`;
    const target = joinPath(ctx.versionDir, filename);
    await cmd.download_to_path(f.url, target);
    const iterIdx = ctx.expandToIterations
      ? Math.min(ctx.iterationBase + i, ctx.iterationTotal)
      : ctx.iterationBase;
    const meta = buildMetadataRecord(ctx, iterIdx);
    await cmd.image_metadata_write(target, meta as unknown as ImageMetadata);
    written.push(target);
  }
  return written;
}

function buildMetadataRecord(ctx: DownloadCtx, iterationIndex: number) {
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
    providerResponse: ctx.out.raw,
  };
}

function tsNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  // Millisecond suffix prevents same-second filename collisions when two
  // concurrent jobs write to the same versionDir at once.
  return (
    `${d.getFullYear()}` +
    `${p(d.getMonth() + 1)}` +
    `${p(d.getDate())}` +
    `_${p(d.getHours())}` +
    `${p(d.getMinutes())}` +
    `${p(d.getSeconds())}` +
    `_${ms}`
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

// Pulls every diagnostically useful field out of arbitrary SDK errors. fal's
// ApiError uses `body.detail`, replicate's errors carry status + response,
// raw fetch failures carry only message — without this, a "500" looks like
// the bare string "HTTP 500" with no hint of which call or what the server said.
function extractErrorMessage(e: unknown): string {
  if (e == null) return "Unknown error";
  if (typeof e === "string") return e;

  const err = e as Record<string, unknown> & {
    name?: string;
    message?: string;
    status?: number;
    statusCode?: number;
    cause?: unknown;
    body?: unknown;
    response?: unknown;
  };

  const parts: string[] = [];

  const status =
    typeof err.status === "number"
      ? err.status
      : typeof err.statusCode === "number"
      ? err.statusCode
      : undefined;
  if (status) parts.push(`HTTP ${status}`);

  const stringify = (v: unknown): string =>
    typeof v === "string" ? v : (() => {
      try {
        return JSON.stringify(v, null, 2);
      } catch {
        return String(v);
      }
    })();

  // Walk a handful of common shapes. First hit wins per category.
  const body = err.body as Record<string, unknown> | string | undefined;
  if (typeof body === "string" && body.length > 0) {
    parts.push(body);
  } else if (body && typeof body === "object") {
    const detail = (body as Record<string, unknown>).detail;
    const error = (body as Record<string, unknown>).error;
    const message = (body as Record<string, unknown>).message;
    const title = (body as Record<string, unknown>).title;
    if (detail !== undefined) parts.push(stringify(detail));
    else if (error !== undefined) parts.push(stringify(error));
    else if (message !== undefined) parts.push(stringify(message));
    else if (title !== undefined) parts.push(stringify(title));
    else parts.push(stringify(body));
  }

  const response = err.response as
    | { data?: unknown; statusText?: string }
    | undefined;
  if (response) {
    if (response.data !== undefined && parts.length <= 1) {
      parts.push(stringify(response.data));
    }
    if (response.statusText) parts.push(response.statusText);
  }

  if (parts.length === 0 && err.message) parts.push(String(err.message));
  if (parts.length === 0 && err.cause) parts.push(stringify(err.cause));
  if (parts.length === 0) parts.push(String(e));

  return parts.join(" — ");
}
