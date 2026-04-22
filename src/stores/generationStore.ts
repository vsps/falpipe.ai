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
  reorderRefs: (fromIdx: number, toIdx: number) => void;

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

// Ensure every element group has exactly one frontal. If none is set, the first
// ref in the group (by panel order) is auto-promoted. User-assigned group
// numbers are left as-is — no auto-renumbering, so higher numbers survive even
// when earlier positions are empty or bear lower numbers.
function ensureFrontals(refs: RefImage[]): RefImage[] {
  const hasFrontal = new Map<string, boolean>();
  for (const r of refs) {
    if (r.roleAssignment?.kind === "element" && r.roleAssignment.frontal) {
      hasFrontal.set(r.roleAssignment.groupName, true);
    }
  }
  const promoted = new Set<string>();
  return refs.map((r) => {
    if (r.roleAssignment?.kind === "element") {
      const g = r.roleAssignment.groupName;
      if (!hasFrontal.get(g) && !promoted.has(g)) {
        promoted.add(g);
        return { ...r, roleAssignment: { ...r.roleAssignment, frontal: true } };
      }
    }
    return r;
  });
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
    set((s) => ({
      refImages: ensureFrontals(s.refImages.filter((r) => r.path !== path)),
    }));
  },
  removeAllRefs() {
    set({ refImages: [] });
  },
  reorderRefs(fromIdx, toIdx) {
    set((s) => {
      if (
        fromIdx === toIdx ||
        fromIdx < 0 ||
        toIdx < 0 ||
        fromIdx >= s.refImages.length ||
        toIdx >= s.refImages.length
      ) {
        return {} as Partial<State>;
      }
      const next = s.refImages.slice();
      const [item] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, item);
      return { refImages: ensureFrontals(next) };
    });
  },
  assignRole(path, role) {
    set((s) => {
      // Enforce exclusivity for start/end: clear from any other ref.
      const exclusive = role && (role.kind === "start" || role.kind === "end") ? role.kind : null;
      const next = s.refImages.map((r) => {
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
      });
      return { refImages: ensureFrontals(next) };
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
