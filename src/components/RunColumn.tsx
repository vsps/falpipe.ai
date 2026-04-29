import { Icon } from "../lib/icon";
import { useGenerationStore } from "../stores/generationStore";
import { useSessionStore } from "../stores/sessionStore";
import { cancelGeneration, runGeneration } from "../lib/generate";
import { showMessage } from "../lib/dialog";
import playSvg from "../icons/play.svg?raw";
import playPlusSvg from "../icons/play-plus.svg?raw";

// Inject width/height so raw <svg> scales with the button instead of defaulting
// to the UA's 300×150. Runs once per raw import — module-scope memo.
const sizedCache = new Map<string, Record<number, string>>();
function sized(raw: string, size: number): string {
  let bySize = sizedCache.get(raw);
  if (!bySize) {
    bySize = {};
    sizedCache.set(raw, bySize);
  }
  if (!bySize[size]) {
    bySize[size] = raw.replace(/<svg\s/, `<svg width="${size}" height="${size}" `);
  }
  return bySize[size];
}

function SvgIcon({ raw, size }: { raw: string; size: number }) {
  return (
    <span
      className="inline-block select-none"
      style={{ width: size, height: size, lineHeight: 0 }}
      dangerouslySetInnerHTML={{ __html: sized(raw, size) }}
    />
  );
}

export function RunColumn() {
  const { iterations, setIterations, generating, currentModel, sequencePrompt, shotPrompts } =
    useGenerationStore();
  const { shotPath, targetVersion, createNextVersion } = useSessionStore();

  const hasPrompt = (sequencePrompt + shotPrompts.join("")).trim().length > 0;
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

  // "Submit +version": roll a new version folder (which becomes the target)
  // and run the generation into it in one click.
  async function runIntoNewVersion() {
    try {
      await createNextVersion();
    } catch (e) {
      await showMessage(String(e), { kind: "error" });
      return;
    }
    await runGeneration();
  }

  const ICON_SIZE = 54;

  return (
    <div className="bg-surface p-prompt-column text-text flex flex-col items-center justify-center gap-prompt-column-gap shrink-0 w-[90px]">
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
        className={canRun ? "hover:opacity-80 text-accent" : "opacity-40 cursor-not-allowed text-accent"}
      >
        <SvgIcon raw={playSvg} size={ICON_SIZE} />
      </button>
      <button
        title={disabledReason || "Submit + new version"}
        disabled={!canRun}
        onClick={() => {
          void runIntoNewVersion();
        }}
        className={canRun ? "hover:opacity-80 text-accent" : "opacity-40 cursor-not-allowed text-accent"}
      >
        <SvgIcon raw={playPlusSvg} size={ICON_SIZE} />
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
