import { Icon } from "../lib/icon";
import { useGenerationStore } from "../stores/generationStore";
import { useSessionStore } from "../stores/sessionStore";
import { cancelGeneration, runGeneration } from "../lib/generate";

export function RunColumn() {
  const { iterations, setIterations, generating, currentModel, sequencePrompt, shotPrompt } =
    useGenerationStore();
  const { shotPath, targetVersion } = useSessionStore();

  const hasPrompt = (sequencePrompt + shotPrompt).trim().length > 0;
  const canRun = !generating && !!currentModel && !!shotPath && targetVersion !== "SRC" && hasPrompt;

  const disabledReason = !currentModel
    ? "Pick a model"
    : !shotPath
    ? "Open a shot"
    : !hasPrompt
    ? "Enter a prompt"
    : targetVersion === "SRC"
    ? "SRC is not a valid target"
    : generating
    ? "Generating..."
    : "";

  return (
    <div className="bg-surface p-[10px] text-text flex flex-col items-center justify-center gap-[8px] shrink-0 w-[90px]">
      <span className="text-xs font-semibold">ITERATIONS</span>
      <input
        type="number"
        min={1}
        value={iterations}
        onChange={(e) => setIterations(parseInt(e.currentTarget.value, 10))}
        className="w-16 text-center bg-bg text-text py-[2px]"
      />
      <button
        title={disabledReason || "Submit"}
        disabled={!canRun}
        onClick={() => {
          void runGeneration();
        }}
        className={canRun ? "hover:opacity-80" : "opacity-40 cursor-not-allowed"}
      >
        <Icon name="play_circle" size={60} />
      </button>
      <button
        title={generating ? "Cancel" : "Nothing to cancel"}
        disabled={!generating}
        onClick={cancelGeneration}
        className={generating ? "hover:opacity-80" : "opacity-40 cursor-not-allowed"}
      >
        <Icon name="cancel" size={60} />
      </button>
    </div>
  );
}
