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
  | { kind: "element"; groupName: string; frontal: boolean };

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
};

export type PromptHistoryChannel = {
  entries: PromptEntry[];
  cursor: number; // entries.length == live (showing liveValue from generationStore)
};

// ---------- Persisted config + state ----------

export type ColorOverrides = {
  bg?: string;
  panel?: string;
  surface?: string;
  text?: string;
  accent?: string;
};

export type Config = {
  windowBounds: { x?: number; y?: number; width: number; height: number };
  projectPath: string;
  lastSequence: string;
  lastShot: string;
  lastModel: string;
  testMode: boolean;
  testImagePath: string;
  ffmpegPath: string;
  colors?: ColorOverrides;
};

export type AppState = {
  projectPath: string;
  lastSequence: string;
  lastShot: string;
  lastModel: string;
  sequencePrompt: string;
  shotPrompt: string;
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
  combinedPrompt?: string;
  // Back-compat with old single-prompt sidecars.
  prompt?: string;
  settings: Record<string, unknown>;
  refs: (RefSnapshot | string)[];
  iterationIndex?: number;
  iterationTotal?: number;
  timestamp: string;
  falResponse: unknown;
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
};
