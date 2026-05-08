import { useEffect, useState } from "react";
import { useGenerationStore } from "../stores/generationStore";
import { useSessionStore } from "../stores/sessionStore";
import { IconBtn } from "./IconBtn";

type Scope = "sequence" | "shot";

type Props = {
  scope: Scope;
  title: string;
};

export function PromptColumn({ scope, title }: Props) {
  if (scope === "shot") return <ShotPromptColumn title={title} />;
  return <SequencePromptColumn title={title} />;
}

// ---------- Sequence: single textarea, store-managed cursor ----------

function SequencePromptColumn({ title }: { title: string }) {
  const generation = useGenerationStore();
  const session = useSessionStore();

  const history = session.sequenceHistory;
  const live = generation.sequencePrompt;
  const setLive = generation.setSequencePrompt;

  const atLive = history.cursor >= history.entries.length;
  const displayed = atLive ? live : history.entries[history.cursor]?.prompt ?? "";
  const readOnly = !atLive;
  const entry = atLive ? null : history.entries[history.cursor];

  const canGoBack = history.cursor > 0 && history.entries.length > 0;
  const canGoFwd = history.cursor < history.entries.length;

  return (
    <div className="bg-surface border border-border p-prompt-column text-text w-[300px] flex flex-col gap-prompt-column-gap shrink-0">
      <div className="flex items-center text-sm gap-[4px] font-semibold">
        <span>{title}</span>
        {history.entries.length > 0 && (
          <span className="text-xs opacity-60 font-mono">
            {atLive ? history.entries.length : `${history.cursor + 1}/${history.entries.length}`}
          </span>
        )}
        <div className="flex-1" />
        <IconBtn
          name="keyboard_arrow_left"
          size={18}
          title={entry ? `Older · ${entry.timestamp}` : "Older"}
          onClick={() => session.navigatePromptHistory("sequence", -1)}
          disabled={!canGoBack}
        />
        <IconBtn
          name="keyboard_arrow_right"
          size={18}
          title="Newer / live"
          onClick={() => session.navigatePromptHistory("sequence", +1)}
          disabled={!canGoFwd}
        />
      </div>

      <textarea
        value={displayed}
        readOnly={readOnly}
        onFocus={() => {
          if (readOnly) session.snapToLive("sequence");
        }}
        onChange={(e) => setLive(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.altKey && e.key === "ArrowLeft") {
            e.preventDefault();
            session.navigatePromptHistory("sequence", -1);
          } else if (e.altKey && e.key === "ArrowRight") {
            e.preventDefault();
            session.navigatePromptHistory("sequence", +1);
          }
        }}
        placeholder="Prompt prepended to all shots in this sequence"
        className={`flex-1 min-h-[120px] w-full resize-none bg-inset text-text p-prompt-panel outline-none ${
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

// ---------- Shot: N textareas, column-level cursor over grouped history ----------

function ShotPromptColumn({ title }: { title: string }) {
  const gen = useGenerationStore();
  const entries = useSessionStore((s) => s.shotHistory.entries);
  const [cursor, setCursor] = useState(entries.length);

  // After a submit (entries grow), snap back to live.
  useEffect(() => {
    setCursor(entries.length);
  }, [entries.length]);

  const safeCursor = Math.min(cursor, entries.length);
  const atLive = safeCursor >= entries.length;
  const histEntry = atLive ? null : entries[safeCursor];

  // Historical entries now carry a `prompts` array of sub-prompts.
  // Fall back to a single-element array wrapping `prompt` for legacy entries.
  const displayedPrompts: string[] = atLive
    ? gen.shotPrompts
    : histEntry?.prompts ?? [histEntry?.prompt ?? ""];

  const canGoBack = safeCursor > 0 && entries.length > 0;
  const canGoFwd = safeCursor < entries.length;

  return (
    <div className="bg-surface border border-border p-prompt-column text-text w-[300px] flex flex-col gap-prompt-column-gap shrink-0 min-h-0">
      <div className="flex items-center text-sm gap-[4px] font-semibold">
        <span>{title}</span>
        {entries.length > 0 && (
          <span className="text-xs opacity-60 font-mono">
            {atLive ? entries.length : `${safeCursor + 1}/${entries.length}`}
          </span>
        )}
        <div className="flex-1" />
        <button
          className="text-xs opacity-50 hover:opacity-100 px-1"
          title="Clear all shot prompts"
          onClick={() => gen.setShotPrompts([""])}
        >
          clear
        </button>
        <IconBtn
          name="keyboard_arrow_left"
          size={18}
          title={histEntry ? `Older · ${histEntry.timestamp}` : "Older"}
          onClick={() => setCursor((c) => Math.max(0, c - 1))}
          disabled={!canGoBack}
        />
        <IconBtn
          name="keyboard_arrow_right"
          size={18}
          title="Newer / live"
          onClick={() => setCursor((c) => Math.min(entries.length, c + 1))}
          disabled={!canGoFwd}
        />
      </div>

      <div className="flex-1 min-h-0 flex flex-col gap-prompt-column-gap overflow-y-auto thin-scroll pr-[6px]">
        {displayedPrompts.map((value, idx) => (
          <ShotPromptBox
            key={idx}
            index={idx}
            value={value}
            readOnly={!atLive}
            isFirst={idx === 0}
            onChange={(v) => gen.setShotPromptAt(idx, v)}
            onAdd={() => gen.addShotPromptAfter(idx)}
            onRemove={() => gen.removeShotPromptAt(idx)}
            onFocusWhenReadOnly={() => setCursor(entries.length)}
          />
        ))}
      </div>

      {histEntry && (
        <div className="text-xs opacity-60 font-mono truncate" title={histEntry.timestamp}>
          {new Date(histEntry.timestamp).toLocaleString()}
        </div>
      )}
    </div>
  );
}

type ShotPromptBoxProps = {
  index: number;
  value: string;
  readOnly: boolean;
  isFirst: boolean;
  onChange: (v: string) => void;
  onAdd: () => void;
  onRemove: () => void;
  onFocusWhenReadOnly: () => void;
};

function ShotPromptBox({ index, value, readOnly, isFirst, onChange, onAdd, onRemove, onFocusWhenReadOnly }: ShotPromptBoxProps) {
  return (
    <div className="flex flex-col gap-[4px]">
      <div className="flex items-center gap-[4px] text-xs opacity-80">
        <span className="font-mono">#{index + 1}</span>
        <div className="flex-1" />
        {!readOnly && (
          <>
            <IconBtn name="add" size={16} title="Add prompt below" onClick={onAdd} />
            {!isFirst && <IconBtn name="remove" size={16} title="Remove this prompt" onClick={onRemove} />}
          </>
        )}
      </div>

      <textarea
        value={value}
        readOnly={readOnly}
        onFocus={() => { if (readOnly) onFocusWhenReadOnly(); }}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); onFocusWhenReadOnly(); }
        }}
        placeholder={isFirst ? "Shot prompt" : "Additional shot prompt"}
        className={`min-h-[120px] w-full resize-none bg-inset text-text p-prompt-panel outline-none ${
          readOnly ? "opacity-70 cursor-text" : ""
        }`}
      />
    </div>
  );
}
