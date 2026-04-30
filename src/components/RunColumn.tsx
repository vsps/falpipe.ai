import { Icon } from "../lib/icon";
import { useGenerationStore } from "../stores/generationStore";
import { useSessionStore } from "../stores/sessionStore";
import { cancelAllGenerations, enqueueGeneration } from "../lib/generate";
import { showMessage } from "../lib/dialog";
import { basename } from "../lib/paths";
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
  const { iterations, setIterations, currentModel, sequencePrompt, shotPrompts, jobs } =
    useGenerationStore();
  const { shotPath, targetVersion, createNextVersion } = useSessionStore();

  const activeJobs = jobs.filter(
    (j) => j.status !== "done" && j.status !== "failed" && j.status !== "cancelled",
  );
  const queueCount = activeJobs.length;

  const hasPrompt = (sequencePrompt + shotPrompts.join("")).trim().length > 0;
  // Submit is allowed even while jobs are in flight — extra clicks just enqueue.
  const canRun = !!currentModel && !!shotPath && targetVersion !== "SRC" && hasPrompt;

  const disabledReason = !currentModel
    ? "Pick a model"
    : !shotPath
    ? "Open a shot"
    : !hasPrompt
    ? "Enter a prompt"
    : targetVersion === "SRC"
    ? "SRC is not a valid target"
    : "";

  // "Submit +version": roll a new version folder (which becomes the target)
  // and enqueue a generation into it in one click.
  async function runIntoNewVersion() {
    try {
      await createNextVersion();
    } catch (e) {
      await showMessage(String(e), { kind: "error" });
      return;
    }
    await enqueueGeneration();
  }

  const queueTitle =
    queueCount === 0
      ? "No active jobs"
      : activeJobs
          .map((j) => `${j.modelName} · ${basename(j.shotPath)}/${j.targetVersion} · ${j.progressMessage}`)
          .join("\n");

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
          void enqueueGeneration();
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
      {queueCount > 0 && (
        <span
          className="text-xs font-mono bg-bg text-text px-1 py-[1px] cursor-help"
          title={queueTitle}
        >
          Q: {queueCount}
        </span>
      )}
      <button
        title={queueCount > 0 ? `Cancel all (${queueCount})` : "Nothing to cancel"}
        disabled={queueCount === 0}
        onClick={cancelAllGenerations}
        className={queueCount > 0 ? "hover:opacity-80" : "opacity-40 cursor-not-allowed"}
      >
        <Icon name="cancel" size={60} />
      </button>
    </div>
  );
}
