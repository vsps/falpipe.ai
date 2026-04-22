import { useEffect, useState } from "react";
import { bootstrap } from "./lib/bootstrap";
import { SessionBar } from "./components/SessionBar";
import { ModelSettingsColumn } from "./components/ModelSettingsColumn";
import { PromptColumn } from "./components/PromptColumn";
import { RefImagesColumn } from "./components/RefImagesColumn";
import { RunColumn } from "./components/RunColumn";
import { Gallery } from "./components/Gallery";
import { ErrorPopup } from "./components/ErrorPopup";
import { LogWindow } from "./components/LogWindow";
import { SettingsDialog } from "./components/SettingsDialog";
import { useGenerationStore } from "./stores/generationStore";
import { useModelsStore } from "./stores/modelsStore";
import { useSessionStore } from "./stores/sessionStore";

export default function App() {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const traceActive = useSessionStore((s) => s.traceActive);
  const setTrace = useSessionStore((s) => s.setTrace);

  useEffect(() => {
    let dispose: (() => void) | null = null;
    bootstrap()
      .then((d) => {
        dispose = d;
        setReady(true);
      })
      .catch((e) => {
        setBootError(String(e));
        setReady(true);
      });
    return () => {
      if (dispose) dispose();
    };
  }, []);

  // Global Esc: exit trace (only if no other modal is open — ErrorPopup / zoom modal handle their own).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && traceActive) {
        setTrace(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [traceActive, setTrace]);

  return (
    <div className="flex h-full w-full flex-col gap-[5px] bg-bg p-[5px] text-text">
      <SessionBar onOpenSettings={() => setSettingsOpen(true)} />

      <div className="flex flex-1 min-h-0 gap-[5px] bg-panel overflow-hidden">
        <ModelSettingsColumn />
        <PromptColumn scope="sequence" title="SEQUENCE PROMPT" />
        <PromptColumn scope="shot" title="SHOT PROMPT" />
        <RefImagesColumn />
        <RunColumn />
      </div>

      <Gallery />

      <LogWindow />
      <StatusBar ready={ready} bootError={bootError} />
      <ErrorPopup />
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

function StatusBar({ ready, bootError }: { ready: boolean; bootError: string | null }) {
  const { entries, loaded } = useModelsStore();
  const { progressMessage, generating, currentIteration, iterations } = useGenerationStore();
  const { traceActive } = useSessionStore();
  return (
    <div className="bg-panel text-dim px-2 py-1 text-xs font-mono whitespace-nowrap overflow-hidden flex items-center gap-4">
      <span>{ready ? "ready" : "booting..."}</span>
      <span>models: {loaded ? entries.length : "…"}</span>
      {bootError && <span className="text-bad">boot error: {bootError}</span>}
      {generating && (
        <span className="text-text">
          {progressMessage || "Generating..."}
          {iterations > 1 ? ` · ${currentIteration}/${iterations}` : ""}
        </span>
      )}
      {!generating && progressMessage && <span>{progressMessage}</span>}
      {traceActive && (
        <span className="text-warn">
          tracing · {traceActive.traceSet.size} images (Esc to exit)
        </span>
      )}
    </div>
  );
}
