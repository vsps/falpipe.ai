import { cmd } from "./tauri";
import { basename, joinPath } from "./paths";
import { applyColors } from "./colors";
import type { AppState, Config } from "./types";
import { useGenerationStore } from "../stores/generationStore";
import { useModelsStore } from "../stores/modelsStore";
import { useSessionStore } from "../stores/sessionStore";

function emptyAppState(): AppState {
  return {
    projectPath: "",
    lastSequence: "",
    lastShot: "",
    lastModel: "",
    sequencePrompt: "",
    shotPrompt: "",
    settings: {},
    refImages: [],
    iterations: 1,
    galleryHeight: 400,
  };
}

function currentAppState(): AppState {
  const g = useGenerationStore.getState();
  const s = useSessionStore.getState();
  return {
    projectPath: s.projectPath ?? "",
    lastSequence: basename(s.sequencePath),
    lastShot: basename(s.shotPath),
    lastModel: g.currentModel?.id ?? "",
    sequencePrompt: g.sequencePrompt,
    shotPrompt: g.shotPrompt,
    settings: g.settings,
    refImages: g.refImages,
    iterations: g.iterations,
    galleryHeight: 400,
  };
}

export async function bootstrap(): Promise<() => void> {
  // Kick off models load early (independent).
  const modelsPromise = useModelsStore.getState().loadAll();

  const [appStateRaw, configRaw] = await Promise.all([
    cmd.app_state_load().catch(() => null),
    cmd.config_load().catch(() => null),
    modelsPromise,
  ]);
  const appState: AppState = (appStateRaw as AppState | null) ?? emptyAppState();
  const config = (configRaw as Config | null) ?? null;

  // Apply color overrides (if any) at startup.
  if (config?.colors) applyColors(config.colors);

  // Apply model selection (before settings so defaults don't overwrite persisted).
  const entries = useModelsStore.getState().entries;
  const persistedModel = appState.lastModel
    ? entries.find((e) => e.node.id === appState.lastModel)?.node ?? null
    : null;
  const gen = useGenerationStore.getState();
  if (persistedModel) gen.selectModel(persistedModel);

  // Apply remaining generation state.
  const persistedSettings = (appState.settings ?? {}) as Record<string, unknown>;
  if (persistedModel && persistedSettings && typeof persistedSettings === "object") {
    for (const [k, v] of Object.entries(persistedSettings)) {
      gen.setSetting(k, v);
    }
  }
  gen.setSequencePrompt(appState.sequencePrompt ?? "");
  gen.setShotPrompt(appState.shotPrompt ?? "");
  gen.setIterations(appState.iterations ?? 1);
  useGenerationStore.setState({ refImages: appState.refImages ?? [] });

  // Restore session paths.
  const session = useSessionStore.getState();
  if (appState.projectPath) {
    try {
      await session.setProject(appState.projectPath);
      if (appState.lastSequence) {
        const seqPath = joinPath(appState.projectPath, appState.lastSequence);
        try {
          await useSessionStore.getState().setSequence(seqPath);
          if (appState.lastShot) {
            const sp = useSessionStore.getState().sequencePath;
            if (sp) {
              const shotPath = joinPath(sp, appState.lastShot);
              try {
                await useSessionStore.getState().setShot(shotPath);
              } catch (e) {
                console.warn(`[bootstrap] shot restore failed for ${shotPath}:`, e);
              }
            }
          }
        } catch (e) {
          console.warn(`[bootstrap] sequence restore failed for ${seqPath}:`, e);
        }
      }
    } catch (e) {
      console.warn(`[bootstrap] project restore failed for ${appState.projectPath}:`, e);
    }
  }

  return installPersistence();
}

function installPersistence(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSerialized = JSON.stringify(currentAppState());

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const state = currentAppState();
      const serialized = JSON.stringify(state);
      if (serialized === lastSerialized) return;
      lastSerialized = serialized;
      void cmd.app_state_save(state).catch(() => {
        /* swallow */
      });
    }, 500);
  };

  const unsubG = useGenerationStore.subscribe(schedule);
  const unsubS = useSessionStore.subscribe(schedule);

  return () => {
    unsubG();
    unsubS();
    if (timer) clearTimeout(timer);
  };
}
