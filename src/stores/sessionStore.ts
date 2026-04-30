import { create } from "zustand";
import type {
  GalleryColumn,
  PromptHistoryChannel,
  SequenceSidecar,
  ShotSidecar,
} from "../lib/types";
import { cmd } from "../lib/tauri";

type PromptScope = "sequence" | "shot";

type State = {
  projectPath: string | null;
  sequencePath: string | null;
  shotPath: string | null;

  sequencesInProject: string[]; // absolute paths
  shotsInSequence: string[]; // absolute paths

  columns: GalleryColumn[];
  selectedImagePath: string | null;
  zoomImagePath: string | null;
  targetVersion: string | null;

  sequenceHistory: PromptHistoryChannel;
  shotHistory: PromptHistoryChannel;

  traceActive: { imagePath: string; traceSet: Set<string> } | null;

  galleryHeight: number;
  thumbColWidth: number;
  logHeight: number;
};

type Actions = {
  setProject: (projectPath: string) => Promise<void>;
  setSequence: (sequencePath: string) => Promise<void>;
  setShot: (shotPath: string) => Promise<void>;
  rescanShot: () => Promise<void>;
  setTargetVersion: (version: string | null) => void;
  createSequence: (name: string) => Promise<void>;
  createShot: (name: string) => Promise<void>;
  createNextVersion: () => Promise<string>;

  setSelectedImage: (path: string | null) => void;
  setZoomImage: (path: string | null) => void;
  setTrace: (state: State["traceActive"]) => void;

  navigatePromptHistory: (scope: PromptScope, delta: number) => void;
  snapToLive: (scope: PromptScope) => void;

  hydrateSequenceSidecar: (sidecar: SequenceSidecar | null) => void;
  hydrateShotSidecar: (sidecar: ShotSidecar | null) => void;

  setGalleryHeight: (n: number) => void;
  setThumbColWidth: (n: number) => void;
  setLogHeight: (n: number) => void;
};

const GALLERY_H_MIN = 120;
const GALLERY_H_MAX = 1200;
const THUMB_W_MIN = 120;
const THUMB_W_MAX = 400;
const LOG_H_MIN = 24;
const LOG_H_MAX = 600;
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Math.round(n)));

const emptyChannel = (): PromptHistoryChannel => ({ entries: [], cursor: 0 });

function latestVersion(columns: GalleryColumn[]): string | null {
  const vs = columns.filter((c) => !c.isSrc).map((c) => c.version);
  return vs.length ? vs[vs.length - 1] : null;
}

export const useSessionStore = create<State & Actions>((set, get) => ({
  projectPath: null,
  sequencePath: null,
  shotPath: null,

  sequencesInProject: [],
  shotsInSequence: [],

  columns: [],
  selectedImagePath: null,
  zoomImagePath: null,
  targetVersion: null,

  sequenceHistory: emptyChannel(),
  shotHistory: emptyChannel(),

  traceActive: null,

  galleryHeight: 400,
  thumbColWidth: THUMB_W_MIN,
  logHeight: 78,

  async setProject(projectPath) {
    // Rust's list_dirs returns forward-slash paths. Normalize the incoming path
    // the same way so the PROJECT/SEQUENCE/SHOT dropdowns string-match their options.
    const normalized = projectPath.replaceAll("\\", "/").replace(/\/+$/, "");
    const sequences = await cmd.project_open(normalized);
    set({
      projectPath: normalized,
      sequencesInProject: sequences,
      sequencePath: null,
      shotPath: null,
      shotsInSequence: [],
      columns: [],
      targetVersion: null,
      selectedImagePath: null,
      sequenceHistory: emptyChannel(),
      shotHistory: emptyChannel(),
    });
  },

  async setSequence(sequencePath) {
    const { shots, sidecar } = await cmd.sequence_open(sequencePath);
    set({
      sequencePath,
      shotsInSequence: shots,
      shotPath: null,
      columns: [],
      targetVersion: null,
      selectedImagePath: null,
      sequenceHistory: {
        entries: sidecar.promptHistory,
        cursor: sidecar.promptHistory.length,
      },
      shotHistory: emptyChannel(),
    });
  },

  async setShot(shotPath) {
    const { columns, sidecar } = await cmd.shot_open(shotPath);
    set({
      shotPath,
      columns,
      targetVersion: latestVersion(columns),
      selectedImagePath: null,
      shotHistory: {
        entries: sidecar.promptHistory,
        cursor: sidecar.promptHistory.length,
      },
    });
  },

  async rescanShot() {
    const { shotPath } = get();
    if (!shotPath) return;
    const columns = await cmd.shot_rescan(shotPath);
    set((s) => ({
      columns,
      targetVersion:
        s.targetVersion && columns.some((c) => c.version === s.targetVersion)
          ? s.targetVersion
          : latestVersion(columns),
    }));
  },

  setTargetVersion(version) {
    set({ targetVersion: version });
  },

  async createSequence(name) {
    const { projectPath } = get();
    if (!projectPath) throw new Error("no project");
    const seqPath = await cmd.sequence_create(projectPath, name);
    const sequences = await cmd.project_open(projectPath);
    set({ sequencesInProject: sequences });
    await get().setSequence(seqPath);
  },

  async createShot(name) {
    const { sequencePath } = get();
    if (!sequencePath) throw new Error("no sequence");
    const shotPath = await cmd.shot_create(sequencePath, name);
    const { shots } = await cmd.sequence_open(sequencePath);
    set({ shotsInSequence: shots });
    await get().setShot(shotPath);
  },

  async createNextVersion() {
    const { shotPath } = get();
    if (!shotPath) throw new Error("no shot");
    const version = await cmd.version_create_next(shotPath);
    await get().rescanShot();
    set({ targetVersion: version });
    return version;
  },

  setSelectedImage(path) {
    set({ selectedImagePath: path });
  },

  setZoomImage(path) {
    set({ zoomImagePath: path });
  },

  setTrace(state) {
    set({ traceActive: state });
  },

  navigatePromptHistory(scope, delta) {
    set((s) => {
      const ch = scope === "sequence" ? s.sequenceHistory : s.shotHistory;
      const next = Math.max(0, Math.min(ch.entries.length, ch.cursor + delta));
      const patch = { ...ch, cursor: next };
      return scope === "sequence"
        ? { sequenceHistory: patch }
        : { shotHistory: patch };
    });
  },

  snapToLive(scope) {
    set((s) => {
      const ch = scope === "sequence" ? s.sequenceHistory : s.shotHistory;
      if (ch.cursor === ch.entries.length) return {} as Partial<State>;
      const patch = { ...ch, cursor: ch.entries.length };
      return scope === "sequence"
        ? { sequenceHistory: patch }
        : { shotHistory: patch };
    });
  },

  hydrateSequenceSidecar(sidecar) {
    const entries = sidecar?.promptHistory ?? [];
    set({ sequenceHistory: { entries, cursor: entries.length } });
  },
  hydrateShotSidecar(sidecar) {
    const entries = sidecar?.promptHistory ?? [];
    set({ shotHistory: { entries, cursor: entries.length } });
  },

  setGalleryHeight(n) {
    set({ galleryHeight: clamp(n, GALLERY_H_MIN, GALLERY_H_MAX) });
  },
  setThumbColWidth(n) {
    set({ thumbColWidth: clamp(n, THUMB_W_MIN, THUMB_W_MAX) });
  },
  setLogHeight(n) {
    set({ logHeight: clamp(n, LOG_H_MIN, LOG_H_MAX) });
  },
}));
