# faLOCai → React/Tailwind + Tauri Migration Plan

Migration of the existing Python + PySide6 desktop app to a Tauri (Rust) host with a React + Tailwind frontend, with the new UX described in `NEW_APP.md` and the Figma frame (`gUY51Ro9jP2IH1wOpU83Rr` node `15:10`). This document is the single source of truth for feature parity, data contracts, and target architecture.

---

## 1. Feature Inventory

Priorities: **P0** — must ship in v1. **P1** — should ship in v1. **P2** — post-parity.

| # | Feature | Priority | Notes |
|---|---|---|---|
| 1 | Load model JSON definitions from `models/` at startup | P0 | Source of all settings UI schema. |
| 2 | Model picker (dropdown, grouped by image / video) | P0 | Grouping is new vs current app. |
| 3 | Dynamic settings panel rendered from model `parameters[]` | P0 | enum → toggle group, small-int → toggle group, int/float → number input, bool → checkbox. `seed` hidden. |
| 4 | Three-level session bar: Project / Sequence / Shot | P0 | Replaces single session folder. See §2.7. |
| 5 | Sequence prompt editor with prompt history (←/→) | P0 | Sequence-scoped prompt, prepended to shot prompt on submit. |
| 6 | Shot prompt editor with prompt history (←/→) | P0 | Shot-scoped prompt. |
| 7 | Prompt history — per-sequence and per-shot sidecars | P0 | Snapshot appended on each fal submit. Navigable both directions. |
| 8 | Reference images panel (wrap grid, per-image role) | P0 | Each thumb: `@name` label, zoom / remove / settings (role picker). |
| 9 | Per-image role assignment (`source`, `start`, `end`, `element:<name>`) | P0 | `start` and `end` exclusive — setting one clears from other refs. `element:<name>` groups refs; one designated frontal (Kling). |
| 10 | Add / remove-all / remove-single ref actions | P0 | Copy selected files into `<shot>/SRC/` on add. |
| 11 | RUN panel — iterations input, Submit (play), Cancel | P0 | Iterations N ≥ 1. |
| 12 | Iteration dispatch — model-side batch when available, else N serial calls | P0 | Node metadata `batch_field` declares the batching param. |
| 13 | Cancel in-flight generation | P0 | New requirement — was P2 before. |
| 14 | Progress status text | P0 | Queue position / "Generating..." / "Downloading..." / iteration `k/N`. |
| 15 | Gallery: horizontal scroll of version columns | P0 | SRC + `v###` in shot folder. Column width resizable; all resize together. |
| 16 | Target version selection — click column header | P0 | Controls destination of next generation. Defaults to latest version. |
| 17 | Add-new-version button (explicit) | P0 | Button appended after the last column. |
| 18 | Per-column delete (entire version folder) | P0 | Folder-delete icon in column header. Confirm dialog. |
| 19 | Thumbnail actions: add-to-ref / copy-settings / copy-prompt / trace / delete | P0 | Action strip at thumbnail edges. Left-click on image body opens zoom modal. No zoom button, no remove-from-ref, no star. |
| 20 | Copy settings — restores model, prompt(s), settings, refs | P0 | Full regenerate-this preparation. |
| 21 | Copy prompt — prompt only | P0 | One-click load into shot prompt. |
| 22 | Reference trace — hide all thumbnails not in trace set | P0 | `conversion_path` icon on thumbnail. Ancestors of traced image only. Click again or ESC to exit. |
| 23 | Image zoom modal (fit ↔ 100%, metadata footer, actions) | P0 | Opened by left-clicking any thumbnail body (gallery or ref). Only preview in app — no main-screen preview pane. Esc closes. |
| 24 | Error popup on generation failure | P0 | Extracts `body.detail` (string or object → JSON). |
| 25 | Log window: 5-line rolling; INFO/PROGRESS/SUCCESS/ERROR | P0 | Level inferred from message keywords. |
| 26 | Settings dialog: FAL_KEY, test mode + test image, ffmpeg path | P0 | FAL_KEY → `.env`; rest → `config.json`. |
| 27 | Persist window bounds, project/sequence/shot, last model | P0 | On close / on change. |
| 28 | Persist live editor state (model, prompts, settings, refs) | P0 | Debounced 500ms into app-state. |
| 29 | Test mode: hue-shift a local image instead of calling fal.ai | P1 | Offline/no-credit dev. |
| 30 | Video thumbnail extraction via ffmpeg subprocess | P1 | Optional; skip silently if missing. |
| 31 | Model grouping / search in picker | P2 | Flat-with-grouping works for v1. |
| 32 | Metadata editor UI | P2 | External-tools only today. |

Dropped vs old plan: stars / star-filter, main-screen preview pane, reference-trace "highlight" mode (replaced by filter mode).

---

## 2. Data Models

All shapes below are platform-agnostic (TypeScript-style for clarity).

### 2.1 Model definition (loaded from `models/*.json`)

```ts
type ModelFile = {
  family: string;           // e.g. "FLUX"
  category: string;         // e.g. "fal.ai/Image Generation"
  nodes: ModelNode[];
};

type ModelNode = {
  id: string;               // unique, e.g. "flux_dev_txt2img"
  name: string;             // display name
  endpoint: string;         // e.g. "fal-ai/flux/dev"
  kind: "image" | "video";  // drives picker grouping
  inputs: ModelInput[];
  outputs: ModelOutput[];
  ref_roles?: RefRole[];    // present when node accepts reference images
  parameters: Parameter[];
  batch_field?: string;     // api_field that controls N-per-call (e.g. "num_images"). absent ⇒ serial iterations.
};

type ModelInput = {
  name: string;
  data_type: "STRING" | "IMAGE" | "VIDEO";
  api_field: string;
  api_format?: "array";     // wrap scalar into [scalar] when sending
  required: boolean;
};

type ModelOutput = {
  name: string;
  data_type: "IMAGE" | "VIDEO";
  api_field: string;
};

type RefRole = {
  role: "source" | "start" | "end" | "element" | string;
  api_field: string;        // target field on API payload
  max?: number;             // default: unbounded
  exclusive?: boolean;      // true for start/end — only one ref at a time
  named?: boolean;          // true for element — user supplies a group name
};

type Parameter =
  | { type: "enum";  name: string; label: string; api_field: string; default: string; options: string[]; }
  | { type: "int";   name: string; label: string; api_field: string; default: number; min: number; max: number; }
  | { type: "float"; name: string; label: string; api_field: string; default: number; min: number; max: number; step: number; }
  | { type: "bool";  name: string; label: string; api_field: string; default: boolean; };
```

### 2.2 Reference image (with role)

```ts
type RefImage = {
  path: string;                        // absolute path (usually <shot>/SRC/*)
  roleAssignment: RoleAssignment | null;
};

type RoleAssignment =
  | { kind: "source" }
  | { kind: "start" }
  | { kind: "end" }
  | { kind: "element"; groupName: string; frontal: boolean };
```

Rules:

- `start` and `end` are **mutually exclusive across all refs** — assigning either to a ref removes the same role from any other ref.
- `element.groupName` is user-typed (e.g. "hero", "prop_1"). Multiple refs may share a group. Within a group exactly one must have `frontal=true`; assigning `frontal=true` to a ref clears it from its group-mates.
- A ref with `roleAssignment = null` is untagged and goes to the fallback bucket (§3.4).

### 2.3 Application state (runtime)

```ts
type SessionState = {
  projectPath: string | null;          // absolute
  sequencePath: string | null;         // absolute, subdir of projectPath
  shotPath: string | null;             // absolute, subdir of sequencePath
  shotsInSequence: string[];           // for the shot dropdown
  columns: GalleryColumn[];            // scanned from shotPath
  selectedImagePath: string | null;
  targetVersion: string | null;        // latest version by default
  traceActive: { imagePath: string; traceSet: Set<string> } | null;
};

type GenerationState = {
  currentModel: ModelNode | null;
  sequencePrompt: string;              // live editor value
  shotPrompt: string;                  // live editor value
  settings: Record<string, unknown>;   // keyed by api_field
  refImages: RefImage[];
  iterations: number;                  // N ≥ 1
  generating: boolean;
  progressMessage: string;
  currentIteration: number;            // 0 when idle, 1..N while running
  errorPopup: string | null;
};

type PromptHistoryState = {
  sequence: { entries: PromptEntry[]; cursor: number };  // cursor = index of currently-displayed entry; entries.length when "live edit ahead of history"
  shot:     { entries: PromptEntry[]; cursor: number };
};

type PromptEntry = {
  timestamp: string;                   // ISO-8601
  prompt: string;
};

type GalleryColumn = {
  id: string;                          // version string is the id
  version: string;                     // "SRC" | "v001" | ...
  isSrc: boolean;
  images: GalleryImage[];
  timestamp?: string;                  // from first image metadata
  modelName?: string;                  // from first image metadata
};

type GalleryImage = {
  filename: string;
  path: string;                        // absolute
  metadataPath: string;                // sibling .json
  isVideo: boolean;
  thumbPath?: string;                  // for videos: sibling .thumb.png
};
```

### 2.4 Persisted config (`%APPDATA%/falocai/config.json`)

```ts
type Config = {
  windowBounds: { x?: number; y?: number; width: number; height: number };
  projectPath: string;
  lastSequence: string;                // bare name, resolved against projectPath
  lastShot: string;                    // bare name, resolved against projectPath/sequence
  lastModel: string;                   // ModelNode.id
  testMode: boolean;
  testImagePath: string;
  ffmpegPath: string;
};
```

### 2.5 Persisted app state (`%APPDATA%/falocai/app-state.json`)

```ts
type AppState = {
  projectPath: string;
  lastSequence: string;
  lastShot: string;
  lastModel: string;
  sequencePrompt: string;              // live (not yet submitted)
  shotPrompt: string;                  // live
  settings: Record<string, unknown>;
  refImages: RefImage[];               // serialized with roles
  iterations: number;
  galleryHeight: number;
};
```

### 2.6 Sequence sidecar (`<project>/<sequence>/sequence.json`)

```ts
type SequenceSidecar = {
  name: string;
  promptHistory: PromptEntry[];        // append-only; newest last
};
```

### 2.7 Shot sidecar (`<project>/<sequence>/<shot>/shot.json`)

```ts
type ShotSidecar = {
  name: string;
  promptHistory: PromptEntry[];        // append-only; newest last
};
```

### 2.8 `.env` (secret, project-config-scoped — not per shoot folder)

```
FAL_KEY=<key>
```

### 2.9 Image metadata sidecar (`<image-basename>.json`)

```ts
type ImageMetadata = {
  model: string;                       // human name
  modelId: string;                     // ModelNode.id
  endpoint: string;
  sequencePrompt: string;              // the literal text of the sequence prompt at submit time
  shotPrompt: string;                  // the literal text of the shot prompt at submit time
  combinedPrompt: string;              // what was actually sent to fal.ai (§3.4)
  settings: Record<string, unknown>;   // seed omitted if -1
  refs: RefSnapshot[];                 // refs used for this generation
  iterationIndex?: number;             // 1..N when part of a multi-run
  iterationTotal?: number;             // N when part of a multi-run
  timestamp: string;                   // ISO-8601
  falResponse: unknown;                // raw fal.ai response (image dict or video dict)
  // test-mode additions:
  hueShift?: number;
  sourceImage?: string;
};

type RefSnapshot = {
  path: string;                        // absolute path on disk (under SRC/)
  roleAssignment: RoleAssignment | null;
};
```

Note: `starred` field removed. Existing sidecars with `starred` are still read — the field is simply ignored.

### 2.10 Folder layout

```
<projectPath>/
  <sequence>/                          # user-named; arbitrary depth-1 subdir
    sequence.json                      # sequence sidecar (prompt history)
    <shot>/                            # user-named
      shot.json                        # shot sidecar (prompt history)
      SRC/                             # reference images (user-added)
        ref-original-name.png
      v001/
        v001_YYYYMMDD_HHMMSS_001.png
        v001_YYYYMMDD_HHMMSS_001.json
      v002/
        v002_YYYYMMDD_HHMMSS_001.mp4
        v002_YYYYMMDD_HHMMSS_001.thumb.png
        v002_YYYYMMDD_HHMMSS_001.json
```

Version folder naming: `^v\d{3}$`. Shot scanner ignores any non-`SRC`, non-`v###` directory and any `*.thumb.png` when listing images. Sequence scanner lists direct subdirectories that contain a `shot.json` **or** at least one `v###` or `SRC` child (tolerant of hand-created shot folders). Shots can be created via the "+ add shot" button, which prompts for a name and creates the folder.

---

## 3. Core Logic

### 3.1 Model loading

```
loadAllModels():
  for each file in models/*.json:
    try: parse JSON; for each node in file.nodes: yield { family, category, node }
    on parse error: skip file
```

No caching beyond application lifetime.

### 3.2 Session scanning

```
openProject(projectPath) -> list of sequences:
  return direct subdirs of projectPath (any non-hidden folder)

openSequence(sequencePath) -> { shots[], sidecar }:
  shots = subdirs of sequencePath that look like shot folders (contain shot.json, SRC/, or v###)
  sidecar = read sequence.json (or init empty promptHistory=[])

openShot(shotPath) -> { columns[], sidecar }:
  columns = scanShot(shotPath)
  sidecar = read shot.json (or init empty promptHistory=[])

scanShot(shotPath) -> columns[]:
  columns = []
  for each subdirectory d in shotPath:
    if d.name == "SRC" or d.name matches /^v\d{3}$/:
      images = list files in d with extension in {.png,.jpg,.jpeg,.webp,.mp4,.webm}
              excluding *.thumb.png
      columns.push({ version: d.name, isSrc: d.name=="SRC", images })
  sort: SRC first, then version ascending
  return columns

getNextVersion(shotPath) -> "v###":
  max = highest N across /^v(\d{3})$/ subdirs in shotPath (default 0)
  return "v" + zeroPad(max+1, 3)

getLatestVersion(shotPath) -> "v###" | null:
  highest existing v### (null if none)
```

### 3.3 Settings initialization on model change

```
onModelSelected(node):
  gen.settings = {}
  for p in node.parameters:
    gen.settings[p.api_field] = p.default
  gen.currentModel = node
```

`seed` is filtered from the UI but remains in `settings` (default `-1`).

### 3.4 Building the API payload

```
buildArgs(node, sequencePrompt, shotPrompt, settings, uploadedRefs) -> args:
  args = {}

  # seed contract: -1 means "let fal.ai randomize" → OMIT entirely
  for (k, v) in settings:
    if k == "seed" and v == -1: continue
    args[k] = v

  combined = [sequencePrompt, shotPrompt].filter(non-empty).join("\n\n")
  if combined is non-empty: args["prompt"] = combined

  # uploadedRefs: RefImage[] with resolved URLs
  if node.ref_roles exists and non-empty:
    buckets = groupByRole(uploadedRefs)       # { "source": [...], "start": [...], "end": [...], "element": { groupName: [...] }, null: [...] }

    for role in node.ref_roles:
      slice = selectForRole(role, buckets)    # see below
      if slice.length == 0: continue
      if (role.max == 1 or (role.exclusive and slice.length == 1)) and slice.length == 1:
        args[role.api_field] = slice[0].url   # scalar
      else:
        args[role.api_field] = slice.map(r => r.url)  # array

    # unassigned refs fall through to a default field if the model declares one with role=="source" and no source already consumed;
    # otherwise they are dropped (and a warning is surfaced in the log window).

  else if uploadedRefs.length > 0:
    args["image_urls"] = uploadedRefs.map(r => r.url)   # fallback

  # honor per-input api_format = "array"
  for input in node.inputs where input.api_format == "array" and args[input.api_field] is scalar:
    args[input.api_field] = [args[input.api_field]]

  return args

selectForRole(role, buckets):
  if role.role == "element":
    # concatenate element groups; frontal first within each group
    out = []
    for (groupName, refs) in buckets.element:
      sorted = refs with frontal=true first, then others in insertion order
      out.push(...sorted)
    return truncate(out, role.max)

  if role.exclusive:
    return take(buckets[role.role], 1)

  return truncate(buckets[role.role] ?? [], role.max ?? ∞)
```

### 3.5 Iterations dispatch

```
runGeneration(node, sequencePrompt, shotPrompt, settings, refImages, iterations, targetVersion):
  appendPromptHistory(sequence, sequencePrompt)   # only if differs from last entry
  appendPromptHistory(shot,     shotPrompt)

  if node.batch_field and iterations > 1:
    # model-side batch
    settings[node.batch_field] = iterations
    [one invocation] produces N outputs via args.batch_field = iterations
    setIterationMeta(1, iterations)   # all outputs share iterationTotal; iterationIndex assigned 1..N

  else:
    # serial fallback
    for i in 1..iterations:
      [one invocation] with iterationIndex=i, iterationTotal=iterations
      if cancelled: break
```

Both paths write files into the resolved `targetVersion` folder (default latest; explicit pick from UI overrides).

### 3.6 Single invocation (fal.ai)

```
invokeOnce(node, combinedPromptArgs, targetVersion, iterMeta):
  try:
    emit progress "Starting..." (+ iteration k/N if N>1)

    if testMode: return runTestMode(...)

    # 1. Upload refs (only once per generation — cached by caller across iterations)
    # (see runGeneration — uploads happen there, passed in here)

    # 2. Subscribe
    emit progress "Generating..."
    result = fal.subscribe(node.endpoint, args, onProgress: e =>
      if Queued:     emit "Queued (" + e.position + ")"
      else if InProgress: emit "Generating..." (+ iter info)
    )

    # 3. Write files
    versionDir = ensureDir(shotPath + "/" + targetVersion)
    ts = formatTimestamp(now(), "YYYYMMDD_HHMMSS")

    outputs = []
    if result.video:
      emit "Downloading video..."
      filename = targetVersion + "_" + ts + "_001." + extFromUrl(result.video.url)
      downloadFile(result.video.url, versionDir + "/" + filename)
      if ffmpegPath: extractVideoThumbnail(file, file + ".thumb.png", ffmpegPath)
      writeSidecar(file, buildMetadata(node, sequencePrompt, shotPrompt, settings, refImages, result.video, iterMeta))
      outputs.push({ path:file, isVideo:true })
    else:
      emit "Downloading images..."
      images = result.images ?? [result.image]
      for i, img in enumerate(images, start=1):
        ext = settings.output_format ?? extFromUrl(img.url) ?? "png"
        filename = targetVersion + "_" + ts + "_" + zeroPad(i,3) + "." + ext
        downloadFile(img.url, versionDir + "/" + filename)
        writeSidecar(file, buildMetadata(node, ..., img, { ...iterMeta, iterationIndex: iterMeta.iterationIndex + (i-1) }))
        outputs.push({ path:file, isVideo:false })

    emit finished { outputs, version: targetVersion }

  catch err:
    emit error(extractErrorMessage(err))
```

### 3.7 Prompt history

```
appendPromptHistory(scope, prompt):
  sidecarPath = scope == "sequence" ? sequencePath+"/sequence.json" : shotPath+"/shot.json"
  sidecar = readOrInit(sidecarPath)
  last = sidecar.promptHistory[-1]
  if not last or last.prompt != prompt:
    sidecar.promptHistory.push({ timestamp: isoNow(), prompt })
    write atomically
    history[scope].entries = sidecar.promptHistory
    history[scope].cursor = sidecar.promptHistory.length  # "past the end" = live

navigateHistory(scope, delta):
  h = history[scope]
  next = clamp(h.cursor + delta, 0, h.entries.length)  # length = "live"
  h.cursor = next
  editor[scope].value = (next == h.entries.length) ? editor[scope].liveValue : h.entries[next].prompt
```

On editor input, cursor snaps to `entries.length` (live) and `liveValue` updates. Navigating back preserves liveValue so the user can return to the in-progress edit.

### 3.8 Metadata builder

```
buildMetadata(node, sequencePrompt, shotPrompt, settings, refImages, falResponse, iterMeta):
  cleanedSettings = { ...settings }
  if cleanedSettings.seed == -1: delete cleanedSettings.seed
  if node.batch_field: delete cleanedSettings[node.batch_field]   # not meaningful to regenerate
  combined = [sequencePrompt, shotPrompt].filter(non-empty).join("\n\n")

  return {
    model: node.name,
    modelId: node.id,
    endpoint: node.endpoint,
    sequencePrompt,
    shotPrompt,
    combinedPrompt: combined,
    settings: cleanedSettings,
    refs: refImages.map(r => ({ path: r.path, roleAssignment: r.roleAssignment })),
    iterationIndex: iterMeta?.iterationIndex,
    iterationTotal: iterMeta?.iterationTotal,
    timestamp: isoNow(),
    falResponse,
  }
```

### 3.9 Target-version resolution

- Default selection on shot open: **latest** `v###`.
- "Add new version" button: creates `getNextVersion(shotPath)` folder immediately, sets it as target.
- Click column header: sets that column as target.
- Generate button sends to `targetVersion` (creates folder if not yet on disk, e.g. user clicked "add new version").
- If `targetVersion` is `SRC`: disable Generate (SRC is reference-only).
- Mid-flight target switch: files continue landing in the snapshot target (captured at click time). Post-finish reconciliation from the old plan is **dropped** — iteration pipeline makes mid-flight moves racy. Emit a log line noting the locked target.

### 3.10 Copy-settings action

```
copySettingsFrom(imagePath):
  md = readSidecar(imagePath); if missing: toast "No metadata" and abort
  node = findModel(md.modelId); if not found: toast and abort
  setModel(node)
  sequencePrompt = md.sequencePrompt ?? ""
  shotPrompt     = md.shotPrompt ?? md.prompt ?? ""   # back-compat with old single-prompt sidecars
  for (k,v) in md.settings: settings[k] = v
  refImages = md.refs.filter(r => exists(r.path))
  toast "Loaded settings from " + basename(imagePath)
  if md.iterationTotal: iterations = md.iterationTotal
```

Refs pointing to deleted files are silently dropped with a toast indicating N were skipped.

### 3.11 Copy-prompt action

```
copyPromptFrom(imagePath):
  md = readSidecar(imagePath)
  shotPrompt = md.shotPrompt ?? md.prompt ?? ""   # back-compat
```

Only overwrites `shotPrompt` — sequence prompt untouched.

### 3.12 Reference trace (filter mode)

```
startTrace(imagePath):
  visited = set()
  queue = [imagePath]
  while queue:
    p = queue.pop()
    if p in visited: continue
    visited.add(p)
    md = readSidecar(p) or continue
    for r in md.refs:
      if exists(r.path): queue.push(r.path)
  traceActive = { imagePath, traceSet: visited }
  # UI: gallery hides any thumbnail whose path ∉ traceSet

stopTrace():
  traceActive = null
```

Trace icon in thumbnail action strip toggles this. `Esc` exits trace when no modal is open.

### 3.13 Test mode

```
runTestMode(...):
  src = loadImage(settings.testImagePath)
  shifted = shiftHue(src, random(0, 360))
  write to versionDir with same naming scheme
  sidecar extras: { hueShift, sourceImage: settings.testImagePath }
```

Iteration loop applies to test mode too (N hue-shifted outputs per click if batch_field missing).

### 3.14 Persistence cadence

- Any change to `model / sequencePrompt / shotPrompt / settings / refImages / iterations / galleryHeight`: debounce 500ms, write `app-state.json`.
- Window close: write `config.json`.
- Startup: read `config.json` → `app-state.json` → resolve `lastModel` against freshly-loaded models.
- Prompt history sidecars written synchronously on submit (before the fal call fires).

---

## 4. Edge Cases & Error Handling

### 4.1 Inputs

| Case | Behavior |
|---|---|
| `seed == -1` | Omit from API args. Also omit from sidecar `settings`. |
| Model has IMAGE input but user has 0 refs | Allow generate (fal.ai will validate). Do not silently block. |
| Two refs both assigned `start` | Impossible via UI (setting `start` on one clears it from any other). Defensive check on submit: last-writer-wins; log a warning. |
| `element` group with no frontal | Send the group in insertion order; log a warning. Do not block. |
| `element` group with >1 frontal | Impossible via UI (setting `frontal` clears it from group-mates). Defensive check: first in order wins. |
| Required shot prompt missing but sequence prompt set | Allow (combined is non-empty). |
| Both prompts empty | Disable Generate. |
| No project / sequence / shot selected | Disable Generate. |
| `FAL_KEY` missing | Generate fails fast: "FAL_KEY not configured — open Settings". |
| Target version = SRC | Disable Generate. |
| Iterations < 1 or not integer | Clamp to 1. |

### 4.2 API errors

```
extractErrorMessage(err):
  if err.body?.detail:
    return typeof detail == "string" ? detail : JSON.stringify(detail)
  return String(err)
```

Modal titled "Generation Error". Also log ERROR.

### 4.3 File I/O

| Case | Behavior |
|---|---|
| Download timeout (120s) or network fail mid-stream | Abort worker, emit error, delete partial file. |
| `SRC/` missing when shot opened | Create it silently. |
| Shot/sequence sidecar missing | Treat `promptHistory` as empty. |
| Sidecar JSON missing or corrupt | Thumbnail still renders; copy-settings / copy-prompt / trace disabled for that image. |
| Copy ref-to-SRC: filename collision | Overwrite. |
| Delete image: sidecar and `.thumb.png` also removed | Always. |
| Delete column: entire directory removed | With confirm dialog. If targetVersion was that folder, fall back to latest (or null if none left). |
| Video thumbnail: ffmpeg missing or fails | Skip silently; thumb area shows a video-play glyph. |
| Sequence/shot rename on disk while app running | Tolerated on next rescan; broken refs in metadata become invalid (trace / copy-settings skip them). |

### 4.4 Concurrency

- One generation worker at a time (`generating == true` disables Generate).
- Cancel is cooperative: between iterations (serial mode) or propagated to the fal subscribe stream + download (batch mode).
- Mid-flight UI edits to model / prompts / refs / iterations do not affect in-flight args (captured at click time).
- Mid-flight `targetVersion` change does not move files (see §3.9).

### 4.5 Cancellation

Expose an `AbortController`-style token from the Rust side. On cancel:

1. Abort the current fal subscribe stream.
2. Abort any in-flight download; delete partial file.
3. In serial mode, break the iteration loop.
4. Emit `generate.cancelled` to the UI; clear `generating`.

### 4.6 Reference upload caching

Uploads happen once per generation (shared across iterations). Cache is keyed by `(path, mtime, size)` — re-uploads only if the file changed.

---

## 5. API Contract (fal.ai)

### 5.1 Upload

```
POST (SDK or direct HTTP): uploadFile(localPath) -> string (https URL)
```

### 5.2 Subscribe (streaming)

```
subscribe(endpoint, args, { onQueueUpdate })
  -> final result object
events:
  - Queued { position: number }
  - InProgress
  - final: { image | images | video | ... }
```

Response shapes:

```ts
type Result =
  | { image:  { url: string; content_type?: string; file_name?: string; file_size?: number; width?: number; height?: number } }
  | { images: Array<{ url: string; /* same */ }> }
  | { video:  { url: string; content_type?: string; file_name?: string; file_size?: number } };
```

### 5.3 Auth

`FAL_KEY` from `.env`. Held on the Rust side only; never exposed to the webview except through the subset of commands that need it.

---

## 6. Data Flow Diagram

```
[React UI]
  user picks project ───► [cmd: project.open]
                            ▼
                       sequences[] populated
  user picks / creates sequence ───► [cmd: sequence.open]
                            ▼
                       shots[] populated, sequence.json read → sequencePromptHistory
  user picks / creates shot ───► [cmd: shot.open]
                            ▼
                       columns[] scanned, shot.json read → shotPromptHistory
                       latest v### → targetVersion (default)

  user edits sequencePrompt / shotPrompt / settings / iterations
  user adds refs ───► [cmd: ref.copyToSrc]  (copies into <shot>/SRC/)
  user assigns roles in ref panel (exclusive rules enforced client-side)

  user clicks Submit ───► [cmd: generate.start] (args include iterations, refs w/ roles)
                            │  append sequence/shot prompts to sidecars
                            │  resolve targetVersion (create if not on disk)
                            │  upload refs → URLs (cached)
                            │  if node.batch_field and iterations>1: single subscribe, batch param = N
                            │  else: loop 1..N subscribe calls
                            │  download + sidecars (iterationIndex/Total)
                            ▼
                       emit 'generate:progress' (queue / InProgress / k of N)
                       emit 'generate:finished' { outputs, version }  |  'generate:error'  |  'generate:cancelled'

  user clicks Cancel ───► [cmd: generate.cancel]
```

---

## 7. React/Tailwind + Tauri Architecture

### 7.1 Tauri commands (Rust)

| Command | Purpose |
|---|---|
| `config_load` / `config_save` | Read/write `%APPDATA%/falocai/config.json`. |
| `app_state_load` / `app_state_save` | Read/write `app-state.json`. |
| `fal_key_get` / `fal_key_set` | Read/write `.env`. |
| `models_load` | Enumerate `models/*.json`, return `ModelNode[]` with `kind` for grouping. |
| `project_open` | Given a projectPath, list sequence subdirs. |
| `sequence_open` | Given a sequencePath, list shot subdirs + read `sequence.json`. |
| `sequence_create` | Create a sequence subdir. |
| `shot_open` | Scan columns, read `shot.json`. |
| `shot_create` | Create a shot subdir (+ `SRC/`). |
| `shot_rescan` | Re-scan current shot. |
| `sequence_prompt_append` / `shot_prompt_append` | Append to sidecar history. |
| `version_create_next` | Return `v###` and mkdir under current shot. |
| `ref_copy_to_src` | Copy file into `<shot>/SRC/`. |
| `generate_start` | Orchestrate upload → subscribe → download → sidecars; emit events. Returns a generation ID. |
| `generate_cancel` | Abort in-flight generation. |
| `image_metadata_read` / `image_metadata_write` | Sidecar I/O. |
| `image_delete` | Delete image + sidecar + thumb. |
| `column_delete` | Delete version folder. |
| `video_thumbnail_extract` | Call ffmpeg subprocess. |
| `trace_compute` | Given an imagePath, walk sidecar refs → return trace set (can also be done purely client-side). |

**Tauri events** (backend → frontend):

- `generate:progress` { id, message, iteration?, total? }
- `generate:finished` { id, outputs, version }
- `generate:error`    { id, message }
- `generate:cancelled`{ id }
- `log`               { level, message }

### 7.2 Rust dependencies (backend)

- `tauri` (v2)
- `serde` / `serde_json`
- `reqwest` with `stream` feature — downloads + fal HTTP
- `tokio` — async runtime
- `tokio-util` — `CancellationToken` for cooperative cancel
- `uuid` — generation IDs
- `tracing` — logging

Prefer calling fal.ai directly over HTTP from Rust (queue + status SSE / polling + final result). Fallback to a Node sidecar with `@fal-ai/client` only if the HTTP contract proves awkward.

### 7.3 Frontend stack

- React 18 + TypeScript + Vite.
- Tailwind CSS. Palette derived from Figma frame (neutral greys, white tiles) plus dark-panel accents retained from the original QSS where they still serve:
  ```
  bg-app:        #e0e0e0    # session bar bg
  bg-panel:      #d2d2d2    # prompt row / gallery row bg
  bg-panel-dim:  #aaa       # prompts container
  bg-column:     #868686    # individual column (model / prompts / refs / run)
  bg-column-in:  #9d9d9d    # inner content area of a column
  bg-tile:       #fff       # thumbnail background
  bg-tile-add:   #c5c5c5    # add-ref tile background
  bg-thumbcol:   #b7b7b7    # gallery column background
  accent:        #e94560    # primary action (submit hover / destructive confirm)
  text:          #111
  text-dim:      #666
  text-on-dark:  #fff       # labels on bg-column
  border:        #8a8a8a
  success:       #4ade80
  warning:       #fbbf24
  error:         #f87171
  ```
  Fonts: Inter / system-ui at 12px default (matches Figma); Consolas/Menlo for the log window at 11px.
- Icons: Google Material Symbols (referenced directly in Figma). Use `@material-symbols/svg-400` or the web font — match the exact symbol names from the frame (`add_photo_alternate`, `copy_all`, `content_copy`, `conversion_path` (trace), `delete`, `settings`, `folder_delete`, `arrow_drop_down_circle`, `keyboard_arrow_left`, `keyboard_arrow_right`, `play_circle_outline`, `cancel`, `add`, `remove`).
- State: **Zustand** with three stores: `sessionStore` (project/sequence/shot/columns/target/trace), `generationStore` (model, prompts, settings, refs, iterations, generating), `modelsStore`. `subscribe` for debounced persistence (500ms).
- Routing: none.

### 7.4 Component map

| Component | Notes |
|---|---|
| `<App>` | Root layout: three rows — session bar, prompt row, gallery row. |
| `<SessionBar>` | Project/Sequence/Shot controls + settings gear. |
| `<SessionBarCrumb>` | Label + browse button + inline-editable path display. |
| `<ShotDropdown>` | Drop-down of shots in current sequence + add-shot button. |
| `<SettingsDialog>` | FAL_KEY, test mode, test image, ffmpeg path. |
| `<PromptRow>` | Horizontal flex: model / sequence prompt / shot prompt / refs / run. |
| `<ModelSettingsColumn>` | Header + `<ModelPicker>` + `<SettingsPanel>`. |
| `<ModelPicker>` | Grouped dropdown (image / video). |
| `<SettingsPanel>` | Schema-driven (enum/int-small → toggle group; int/float → number input; bool → checkbox; hides `seed`). |
| `<ToggleGroup>` | Segmented-control style. |
| `<PromptColumn>` | Generic prompt column with header (title + ← → history arrows) + `<PromptEditor>`. Used twice (sequence + shot). |
| `<PromptEditor>` | Resizable `<textarea>`. Live state in store; `liveValue` + `cursor` managed via history. |
| `<HistoryArrows>` | `← →` — disabled at ends. Hover tooltip shows timestamp + first-line preview. |
| `<RefImagesColumn>` | Wrap grid of `<RefThumb>` + trailing `<RefAddTile>`. |
| `<RefThumb>` | `@name` (or role badge) at top; remove + settings buttons at bottom. Left-click body opens `<ImageZoomModal>`. |
| `<RefAddTile>` | `add_photo_alternate` + `remove` (remove-all-refs). |
| `<RoleMenu>` | Popover on "settings" click. Lists roles supported by current model (`source`, `start`, `end`, plus free-text `element` field with frontal checkbox). |
| `<RunColumn>` | `ITERATIONS` label + `<input type="number" min="1">`  + play (submit) + cancel. |
| `<Gallery>` | Horizontal scroll of `<GalleryColumn>` + trailing `<AddVersionTile>`. |
| `<GalleryColumn>` | Header (version name + folder-delete) + scrollable `<Thumbnail>` stack. Selected-as-target styling on header. |
| `<Thumbnail>` | Action strip (top: add-to-ref / copy-settings / copy-prompt / trace; bottom-right: delete). Left-click body opens `<ImageZoomModal>`. Hidden when out of trace set. |
| `<ImageZoomModal>` | Fit↔100%, metadata footer, same action set as thumbnail (no self-zoom button). Esc + backdrop close. |
| `<LogWindow>` | Fixed-height 5-line monospace, bottom-right overlay. |
| `<ConfirmDialog>` | Generic. |
| `<ErrorPopup>` | Tailwind modal. |

### 7.5 Local file display

Local disk images are not directly reachable from the webview. Use Tauri's asset protocol:

- Register `asset:` scope for the project directory on project open (covers all sequences/shots).
- Convert paths via `convertFileSrc()` before `<img src>` / `<video src>`.
- Video thumbnails: `<img>` at the `.thumb.png` sibling when present; otherwise a video-play glyph on a grey tile.

### 7.6 Project layout (target)

```
/ (repo root)
  /src
    /components
    /stores
    /lib
    /styles
  /src-tauri
    /src
      main.rs
      commands/*.rs
      fal.rs
      session.rs        # project/sequence/shot scanning, sidecar I/O
      config.rs
      events.rs
    tauri.conf.json
  /models
  MIGRATION_PLAN.md
  NEW_APP.md
  README.md
```

---

## 8. Migration Strategy (execution order)

1. **Scaffolding.** `pnpm create tauri-app` → React + TS. Add Tailwind + palette.
2. **Types + stores.** Land §2 types. Stub Zustand stores.
3. **Tauri commands.** Disk I/O: config, app-state, models, project/sequence/shot open/create, sidecars (sequence.json, shot.json). Exercise from a dev panel.
4. **Shell UI.** Three-row layout, column placeholders, Material icons wired up.
5. **Session bar.** Project/sequence/shot pickers, shot dropdown, add-shot.
6. **Models + settings column.** Model picker (grouped), schema-driven settings panel.
7. **Prompt columns.** Sequence + shot editors, history sidecars, ← → navigation.
8. **Refs column.** Add/remove/role picker with exclusivity rules.
9. **Gallery + thumbnails (read-only).** Horizontal scroll, column headers, target-version selection, add-new-version tile. Asset protocol for image display.
10. **Generate worker — serial path.** `generate_start` single iteration: upload → HTTP to fal queue → stream → download → sidecars. Emit events.
11. **Iteration dispatch.** Add batch_field path and serial loop with cancel.
12. **Thumbnail actions.** Zoom modal, copy-settings, copy-prompt, add-to-ref, delete, folder-delete.
13. **Trace filter.** Compute traceset, hide non-members in gallery.
14. **Error popup + log window.**
15. **Settings dialog.** FAL_KEY, test mode, ffmpeg path.
16. **Test mode + video thumbnails.**
17. **Polish.** Keyboard shortcuts (Esc exits zoom/trace, arrow keys history), focus states, disabled-reason tooltips.
18. **Packaging.** Tauri bundler for Windows MSI.

Parity checkpoint: after step 14 the app is usable end-to-end against real fal.ai.

---

## 9. Risks

- **fal.ai streaming from Rust.** Prototype one endpoint at step 10; fall back to a Node sidecar only if the HTTP contract is awkward.
- **Local file rendering in the webview.** Covered by asset protocol scope (§7.5).
- **Role-exclusivity invariants.** `start`/`end` and frontal-per-element-group are enforced in the role-menu component; the submit path has a defensive check as a safety net. Unit-test the role reducer.
- **Iteration/batch meta in sidecars.** `iterationIndex/Total` must stay stable for copy-settings to restore `iterations` correctly.
- **`seed == -1` contract.** Centralize in `buildArgs` + metadata builder; unit-test.
- **Prompt history growth.** Monotonic append. If a shot accumulates thousands of entries, the sidecar read cost becomes noticeable — acceptable for v1; add pagination / truncation only if a user hits it.

---

## 10. Verification

Ship-readiness checks (manual):

- Launch, pick a project. Create a sequence and a shot. Pick a model. Type sequence + shot prompts. Submit → sequence.json and shot.json each have one entry; sidecar on output has both prompts + combinedPrompt.
- Submit again with a different shot prompt → shot.json has two entries; ← returns to the first, → to the second; typing replaces live value and jumps cursor to end.
- Generate a video (`veo3`); `.thumb.png` present with ffmpeg path set, absent-but-not-broken when unset.
- Open a generated image in the zoom modal → copy-settings → model, both prompts, settings, refs all restore.
- Kill FAL_KEY → generate → error popup shows the missing-key message.
- Trigger a fal.ai error → error popup shows `body.detail` content.
- Run a 4-iteration submit with a model that has `batch_field` → single call, 4 outputs with `iterationIndex` 1..4 / `iterationTotal` 4.
- Run a 4-iteration submit with a model that has no `batch_field` → 4 serial calls; cancel mid-run aborts before the next iteration.
- Click a column header → new submits target that version. Click "add new version" → new `v###` folder created and becomes target.
- Add >1 ref assigned `start` via UI manipulation (e.g. reassigning roles) → only the last-assigned keeps `start`.
- Element group with two refs, one marked frontal → payload places frontal first.
- Trace from an image with refs → gallery hides everything not in the trace set; click trace again or Esc exits.
- Close + reopen app → project/sequence/shot, model, prompts, settings, refs, iterations, window bounds all restored.
- 5-line log window rolls correctly with INFO/PROGRESS/SUCCESS/ERROR coloring.

No automated test harness today. A smoke-test Playwright-under-Tauri suite is a post-parity investment.
