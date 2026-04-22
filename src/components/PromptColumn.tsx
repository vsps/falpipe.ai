import { useGenerationStore } from "../stores/generationStore";
import { useSessionStore } from "../stores/sessionStore";
import { IconBtn } from "./IconBtn";

type Scope = "sequence" | "shot";

type Props = {
  scope: Scope;
  title: string;
};

export function PromptColumn({ scope, title }: Props) {
  const generation = useGenerationStore();
  const session = useSessionStore();

  const history = scope === "sequence" ? session.sequenceHistory : session.shotHistory;
  const live = scope === "sequence" ? generation.sequencePrompt : generation.shotPrompt;
  const setLive = scope === "sequence" ? generation.setSequencePrompt : generation.setShotPrompt;

  const atLive = history.cursor >= history.entries.length;
  const displayed = atLive ? live : history.entries[history.cursor]?.prompt ?? "";
  const readOnly = !atLive;
  const entry = atLive ? null : history.entries[history.cursor];

  const canGoBack = history.cursor > 0 && history.entries.length > 0;
  const canGoFwd = history.cursor < history.entries.length;

  return (
    <div className="bg-surface p-[10px] text-text w-[300px] flex flex-col gap-[8px] shrink-0">
      <div className="flex items-center text-sm gap-[4px] font-semibold">
        <span>{title}</span>
        {!atLive && (
          <span className="text-xs opacity-60 font-mono">
            {history.cursor + 1}/{history.entries.length}
          </span>
        )}
        <div className="flex-1" />
        <IconBtn
          name="keyboard_arrow_left"
          size={18}
          title={entry ? `Older · ${entry.timestamp}` : "Older"}
          onClick={() => session.navigatePromptHistory(scope, -1)}
          disabled={!canGoBack}
        />
        <IconBtn
          name="keyboard_arrow_right"
          size={18}
          title="Newer / live"
          onClick={() => session.navigatePromptHistory(scope, +1)}
          disabled={!canGoFwd}
        />
      </div>

      <textarea
        value={displayed}
        readOnly={readOnly}
        onFocus={() => {
          if (readOnly) session.snapToLive(scope);
        }}
        onChange={(e) => setLive(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.altKey && e.key === "ArrowLeft") {
            e.preventDefault();
            session.navigatePromptHistory(scope, -1);
          } else if (e.altKey && e.key === "ArrowRight") {
            e.preventDefault();
            session.navigatePromptHistory(scope, +1);
          }
        }}
        placeholder={
          scope === "sequence"
            ? "Prompt prepended to all shots in this sequence"
            : "Shot prompt"
        }
        className={`flex-1 min-h-[120px] w-full resize-none bg-inset text-text p-[8px] outline-none ${
          readOnly ? "opacity-70 cursor-text" : ""
        }`}
      />

      {entry && (
        <div className="text-xs opacity-60 font-mono truncate" title={entry.timestamp}>
          {new Date(entry.timestamp).toLocaleString()}
        </div>
      )}
    </div>
  );
}
