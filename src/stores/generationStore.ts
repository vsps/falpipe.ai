import { create } from "zustand";
import type { Job, ModelNode, Parameter, RefImage, RoleAssignment } from "../lib/types";

type State = {
  currentModel: ModelNode | null;
  sequencePrompt: string;
  /** Always >= 1 entry. Multiple boxes are concatenated with `\n\n` at submit. */
  shotPrompts: string[];
  settings: Record<string, unknown>;
  refImages: RefImage[];
  iterations: number;

  /** All in-flight, queued, and recently-finished submissions. Finished
   * entries are pruned on a short tail so the UI can flash success briefly. */
  jobs: Job[];

  errorPopup: string | null;
};

type Actions = {
  selectModel: (model: ModelNode | null) => void;
  setSequencePrompt: (value: string) => void;
  setShotPrompts: (values: string[]) => void;
  setShotPromptAt: (idx: number, value: string) => void;
  addShotPromptAfter: (idx: number) => void;
  removeShotPromptAt: (idx: number) => void;
  setSetting: (key: string, value: unknown) => void;
  setIterations: (n: number) => void;

  addRefs: (paths: string[]) => void;
  removeRef: (path: string) => void;
  removeAllRefs: () => void;
  assignRole: (path: string, role: RoleAssignment | null) => void;
  reorderRefs: (fromIdx: number, toIdx: number) => void;

  resetGenerationForm: () => void;

  addJob: (job: Job) => void;
  updateJob: (id: string, patch: Partial<Job>) => void;
  removeJob: (id: string) => void;
  clearFinishedJobs: () => void;
  setError: (msg: string | null) => void;
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

export const useGenerationStore = create<State & Actions>((set) => ({
  currentModel: null,
  sequencePrompt: "",
  shotPrompts: [""],
  settings: {},
  refImages: [],
  iterations: 1,

  jobs: [],
  errorPopup: null,

  selectModel(model) {
    set({ currentModel: model, settings: model ? defaultsFor(model.parameters) : {} });
  },
  setSequencePrompt(value) {
    set({ sequencePrompt: value });
  },
  setShotPrompts(values) {
    // Always keep at least one box so the UI never collapses to nothing.
    set({ shotPrompts: values.length > 0 ? values : [""] });
  },
  setShotPromptAt(idx, value) {
    set((s) => {
      if (idx < 0 || idx >= s.shotPrompts.length) return {} as Partial<State>;
      const next = s.shotPrompts.slice();
      next[idx] = value;
      return { shotPrompts: next };
    });
  },
  addShotPromptAfter(idx) {
    set((s) => {
      const insertAt = Math.max(0, Math.min(s.shotPrompts.length, idx + 1));
      const next = s.shotPrompts.slice();
      next.splice(insertAt, 0, "");
      return { shotPrompts: next };
    });
  },
  removeShotPromptAt(idx) {
    set((s) => {
      // Refuse to remove the only remaining box — the column always shows one.
      if (s.shotPrompts.length <= 1 || idx < 0 || idx >= s.shotPrompts.length) {
        return {} as Partial<State>;
      }
      const next = s.shotPrompts.slice();
      next.splice(idx, 1);
      return { shotPrompts: next };
    });
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
      const newPaths = paths.filter((p) => !existing.has(p));
      if (newPaths.length === 0) return {} as Partial<State>;
      // Auto-assign the first ref to "start" when the model supports it
      // and no existing ref holds that role.
      const modelHasStart = !!s.currentModel?.ref_roles?.some((r) => r.role === "start");
      const startTaken = s.refImages.some((r) => r.roleAssignment?.kind === "start");
      const shouldAutoStart = modelHasStart && !startTaken;
      const added = newPaths.map<RefImage>((p, i) => ({
        path: p,
        roleAssignment: shouldAutoStart && i === 0 ? { kind: "start" } : null,
      }));
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

  resetGenerationForm() {
    set((s) => ({
      sequencePrompt: "",
      shotPrompts: [""],
      settings: s.currentModel ? defaultsFor(s.currentModel.parameters) : {},
      refImages: [],
      iterations: 1,
    }));
  },

  addJob(job) {
    set((s) => ({ jobs: [...s.jobs, job] }));
  },
  updateJob(id, patch) {
    set((s) => ({
      jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)),
    }));
  },
  removeJob(id) {
    set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }));
  },
  clearFinishedJobs() {
    set((s) => ({
      jobs: s.jobs.filter(
        (j) => j.status !== "done" && j.status !== "failed" && j.status !== "cancelled",
      ),
    }));
  },
  setError(msg) {
    set({ errorPopup: msg });
  },
}));
