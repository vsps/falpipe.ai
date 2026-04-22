import { create } from "zustand";
import type { ModelNode, Parameter, RefImage, RoleAssignment } from "../lib/types";

type State = {
  currentModel: ModelNode | null;
  sequencePrompt: string;
  shotPrompt: string;
  settings: Record<string, unknown>;
  refImages: RefImage[];
  iterations: number;

  generating: boolean;
  progressMessage: string;
  currentIteration: number;
  generationId: string | null;

  errorPopup: string | null;
};

type Actions = {
  selectModel: (model: ModelNode | null) => void;
  setSequencePrompt: (value: string) => void;
  setShotPrompt: (value: string) => void;
  setSetting: (key: string, value: unknown) => void;
  setIterations: (n: number) => void;

  addRefs: (paths: string[]) => void;
  removeRef: (path: string) => void;
  removeAllRefs: () => void;
  assignRole: (path: string, role: RoleAssignment | null) => void;

  setGenerating: (v: boolean) => void;
  setProgress: (message: string, iter?: number) => void;
  setGenerationId: (id: string | null) => void;
  setError: (msg: string | null) => void;
  resetRuntime: () => void;
};

function defaultsFor(params: Parameter[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of params) out[p.api_field] = p.default;
  return out;
}

export const useGenerationStore = create<State & Actions>((set, get) => ({
  currentModel: null,
  sequencePrompt: "",
  shotPrompt: "",
  settings: {},
  refImages: [],
  iterations: 1,

  generating: false,
  progressMessage: "",
  currentIteration: 0,
  generationId: null,
  errorPopup: null,

  selectModel(model) {
    set({ currentModel: model, settings: model ? defaultsFor(model.parameters) : {} });
  },
  setSequencePrompt(value) {
    set({ sequencePrompt: value });
  },
  setShotPrompt(value) {
    set({ shotPrompt: value });
  },
  setSetting(key, value) {
    set((s) => ({ settings: { ...s.settings, [key]: value } }));
  },
  setIterations(n) {
    set({ iterations: Math.max(1, Math.floor(n || 1)) });
  },

  addRefs(paths) {
    set((s) => {
      const existing = new Set(s.refImages.map((r) => r.path));
      const added = paths
        .filter((p) => !existing.has(p))
        .map<RefImage>((p) => ({ path: p, roleAssignment: null }));
      return { refImages: [...s.refImages, ...added] };
    });
  },
  removeRef(path) {
    set((s) => ({ refImages: s.refImages.filter((r) => r.path !== path) }));
  },
  removeAllRefs() {
    set({ refImages: [] });
  },
  assignRole(path, role) {
    set((s) => {
      // Enforce exclusivity for start/end: clear from any other ref.
      const exclusive = role && (role.kind === "start" || role.kind === "end") ? role.kind : null;
      return {
        refImages: s.refImages.map((r) => {
          if (r.path === path) return { ...r, roleAssignment: role };
          if (exclusive && r.roleAssignment?.kind === exclusive) {
            return { ...r, roleAssignment: null };
          }
          // Frontal uniqueness per element group.
          if (
            role &&
            role.kind === "element" &&
            role.frontal &&
            r.roleAssignment?.kind === "element" &&
            r.roleAssignment.groupName === role.groupName &&
            r.path !== path
          ) {
            return { ...r, roleAssignment: { ...r.roleAssignment, frontal: false } };
          }
          return r;
        }),
      };
    });
  },

  setGenerating(v) {
    set({ generating: v });
  },
  setProgress(message, iter) {
    set({ progressMessage: message, currentIteration: iter ?? get().currentIteration });
  },
  setGenerationId(id) {
    set({ generationId: id });
  },
  setError(msg) {
    set({ errorPopup: msg });
  },
  resetRuntime() {
    set({
      generating: false,
      progressMessage: "",
      currentIteration: 0,
      generationId: null,
    });
  },
}));
