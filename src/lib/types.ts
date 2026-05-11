// Shared domain types. Kept in sync with MIGRATION_PLAN.md §2.

// ---------- Models ----------

export type ModelKind = "image" | "video";

export type ModelInput = {
  name: string;
  data_type: "STRING" | "IMAGE" | "VIDEO";
  api_field: string;
  api_format?: "array";
  required: boolean;
};

export type ModelOutput = {
  name: string;
  data_type: "IMAGE" | "VIDEO";
  api_field: string;
};

export type RefRoleSpec = {
  // Canonical role name. Models in-repo today use "source" | "start" | "end".
  // Free-form string keeps the door open for "element" etc.
  role: string;
  api_field: string;
  max?: number;
  exclusive?: boolean;
  named?: boolean;
};

export type EnumParam = {
  type: "enum";
  name: string;
  label: string;
  api_field: string;
  default: string;
  options: string[];
};

export type IntParam = {
  type: "int";
  name: string;
  label: string;
  api_field: string;
  default: number;
  min: number;
  max: number;
};

export type FloatParam = {
  type: "float";
  name: string;
  label: string;
  api_field: string;
  default: number;
  min: number;
  max: number;
  step: number;
};

export type BoolParam = {
  type: "bool";
  name: string;
  label: string;
  api_field: string;
  default: boolean;
};

export type Parameter = EnumParam | IntParam | FloatParam | BoolParam;

export type ModelNode = {
  id: string;
  name: string;
  endpoint: string;
  kind: ModelKind;
  inputs: ModelInput[];
  outputs: ModelOutput[];
  ref_roles?: RefRoleSpec[];
  parameters: Parameter[];
  batch_field?: string;
  /** Defaults to "fal" when omitted. */
  provider?: "fal" | "replicate";
};

export type ModelEntry = {
  family: string;
  category: string;
  node: ModelNode;
};

// ---------- Reference images ----------

export type RoleAssignment =
  | { kind: "source" }
  | { kind: "start" }
  | { kind: "end" }
  | { kind: "element"; groupName: string; frontal: boolean }
  | { kind: "image"; groupName: string };

export type RefImage = {
  path: string;
  roleAssignment: RoleAssignment | null;
};

// ---------- Gallery ----------

export type GalleryImage = {
  filename: string;
  path: string;
  metadataPath: string;
  isVideo: boolean;
  thumbPath?: string;
  starred?: boolean;
};

export type ShotStarredGroup = {
  shotPath: string;
  shotName: string;
  images: GalleryImage[];
};

export type SeqStarredGroup = {
  seqPath: string;
  seqName: string;
  shots: ShotStarredGroup[];
};

export type GalleryColumn = {
  id: string;
  version: string;
  isSrc: boolean;
  images: GalleryImage[];
  timestamp?: string;
  modelName?: string;
};

// ---------- Prompt history ----------

export type PromptEntry = {
  timestamp: string;
  prompt: string;
  /** Individual sub-prompt panels. Absent on legacy single-prompt entries. */
  prompts?: string[];
};

export type PromptHistoryChannel = {
  entries: PromptEntry[];
  cursor: number; // entries.length == live (showing liveValue from generationStore)
};

// ---------- Persisted config + state ----------

export type ColorOverrides = {
  bg?: string;
  border?: string;
  src?: string;
  handle?: string;
  text?: string;
  accent?: string;
};

export type Config = {
  windowBounds: { x?: number; y?: number; width: number; height: number };
  projectPath: string;
  lastSequence: string;
  lastShot: string;
  lastModel: string;
  ffmpegPath: string;
  /** Max number of submissions running in parallel; default 3. */
  maxConcurrentJobs?: number;
  /** Output filename template. Tokens: <date> <time> <sequence> <shot> <model> <version> <prompt> <iter> <seed> <provider> */
  filenameTemplate?: string;
  colors?: ColorOverrides;
};

// ---------- Submission queue ----------

export type JobStatus =
  | "queued"
  | "uploading"
  | "running"
  | "downloading"
  | "cancelling"
  | "done"
  | "failed"
  | "cancelled";

export type Job = {
  id: string;
  status: JobStatus;
  progressMessage: string;
  currentIteration: number;
  iterations: number;
  modelName: string;
  shotPath: string;
  targetVersion: string;
  error?: string;
  startedAt: number;
};

export type AppState = {
  projectPath: string;
  lastSequence: string;
  lastShot: string;
  lastModel: string;
  sequencePrompt: string;
  /** Legacy single-string shot prompt — read for back-compat only; new state lives in shotPrompts. */
  shotPrompt: string;
  shotPrompts: string[];
  settings: Record<string, unknown>;
  refImages: RefImage[];
  iterations: number;
  galleryHeight: number;
  thumbColWidth: number;
  logHeight: number;
};

export type SequenceSidecar = {
  name: string;
  promptHistory: PromptEntry[];
};

export type ShotSidecar = {
  name: string;
  promptHistory: PromptEntry[];
};

// ---------- Image metadata sidecar ----------

export type RefSnapshot = {
  path: string;
  roleAssignment: RoleAssignment | null;
};

export type ImageMetadata = {
  model: string;
  modelId: string;
  endpoint: string;
  sequencePrompt?: string;
  shotPrompt?: string;
  shotPrompts?: string[];
  combinedPrompt?: string;
  // Back-compat with old single-prompt sidecars.
  prompt?: string;
  settings: Record<string, unknown>;
  refs: (RefSnapshot | string)[];
  iterationIndex?: number;
  iterationTotal?: number;
  timestamp: string;
  /** New field, written by all providers. */
  providerResponse?: unknown;
  /** Legacy field; kept so old sidecars still parse. */
  falResponse?: unknown;
  hueShift?: number;
  sourceImage?: string;
};

// ---------- Generation events ----------

export type GenerateProgressEvent = {
  id: string;
  message: string;
  iteration?: number;
  total?: number;
};

export type GenerateFinishedEvent = {
  id: string;
  outputs: GalleryImage[];
  version: string;
};

export type GenerateErrorEvent = {
  id: string;
  message: string;
};

export type GenerateCancelledEvent = {
  id: string;
};

export type LogEvent = {
  level: "INFO" | "PROGRESS" | "SUCCESS" | "ERROR";
  message: string;
  /** Short tag used to disambiguate concurrent jobs (e.g. first 6 chars of the job id). */
  tag?: string;
};

// ---------- Uploaded references (used by generate / args) ----------

export type UploadedRef = { ref: RefImage; url: string };

export type KlingElement = {
  frontal_image_url: string;
  reference_image_urls: string[];
};
