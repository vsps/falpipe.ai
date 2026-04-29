import { useEffect, useState } from "react";
import { useGenerationStore } from "../stores/generationStore";
import { useSessionStore } from "../stores/sessionStore";
import { IconBtn } from "./IconBtn";
import type { PromptEntry } from "../lib/types";

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
    <div className="bg-surface p-prompt-column text-text w-[300px] flex flex-col gap-prompt-column-gap shrink-0">
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

// ---------- Shot: N textareas, per-box cursors over a shared history ----------

function ShotPromptColumn({ title }: { title: string }) {
  const shotPrompts = useGenerationStore((s) => s.shotPrompts);
  const setShotPromptAt = useGenerationStore((s) => s.setShotPromptAt);
  const addShotPromptAfter = useGenerationStore((s) => s.addShotPromptAfter);
  const removeShotPromptAt = useGenerationStore((s) => s.removeShotPromptAt);
  const entries = useSessionStore((s) => s.shotHistory.entries);

  return (
    <div className="bg-surface p-prompt-column text-text w-[300px] flex flex-col gap-prompt-column-gap shrink-0 min-h-0">
      <div className="flex items-center text-sm gap-[4px] font-semibold">
        <span>{title}</span>
        {entries.length > 0 && (
          <span className="text-xs opacity-60 font-mono">{entries.length}</span>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col gap-prompt-column-gap overflow-y-auto thin-scroll pr-[6px]">
        {shotPrompts.map((value, idx) => (
          <ShotPromptBox
            key={idx}
            index={idx}
            value={value}
            entries={entries}
            isFirst={idx === 0}
            onChange={(v) => setShotPromptAt(idx, v)}
            onAdd={() => addShotPromptAfter(idx)}
            onRemove={() => removeShotPromptAt(idx)}
          />
        ))}
      </div>
    </div>
  );
}

type ShotPromptBoxProps = {
  index: number;
  value: string;
  entries: PromptEntry[];
  isFirst: boolean;
  onChange: (v: string) => void;
  onAdd: () => void;
  onRemove: () => void;
};

function ShotPromptBox({ index, value, entries, isFirst, onChange, onAdd, onRemove }: ShotPromptBoxProps) {
  // Per-box cursor over the shared history. `entries.length` means "live"
  // (showing the editable value). Out-of-range cursors are clamped on render.
  const [cursor, setCursor] = useState<number>(entries.length);

  // After a submit (entries grow), snap each box back to live so the user sees
  // the editable value rather than a stale historical entry.
  useEffect(() => {
    setCursor(entries.length);
  }, [entries.length]);

  const safeCursor = Math.min(cursor, entries.length);
  const atLive = safeCursor >= entries.length;
  const displayed = atLive ? value : entries[safeCursor]?.prompt ?? "";
  const readOnly = !atLive;
  const entry = atLive ? null : entries[safeCursor];

  const canGoBack = safeCursor > 0 && entries.length > 0;
  const canGoFwd = safeCursor < entries.length;

  return (
    <div className="flex flex-col gap-[4px]">
      <div className="flex items-center gap-[4px] text-xs opacity-80">
        <span className="font-mono">#{index + 1}</span>
        {!atLive && (
          <span className="text-xs opacity-60 font-mono">
            {safeCursor + 1}/{entries.length}
          </span>
        )}
        <div className="flex-1" />
        <IconBtn
          name="keyboard_arrow_left"
          size={16}
          title={entry ? `Older · ${entry.timestamp}` : "Older"}
          onClick={() => setCursor((c) => Math.max(0, c - 1))}
          disabled={!canGoBack}
        />
        <IconBtn
          name="keyboard_arrow_right"
          size={16}
          title="Newer / live"
          onClick={() => setCursor((c) => Math.min(entries.length, c + 1))}
          disabled={!canGoFwd}
        />
        <IconBtn name="add" size={16} title="Add prompt below" onClick={onAdd} />
        {!isFirst && <IconBtn name="remove" size={16} title="Remove this prompt" onClick={onRemove} />}
      </div>

      <textarea
        value={displayed}
        readOnly={readOnly}
        onFocus={() => {
          if (readOnly) setCursor(entries.length);
        }}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.altKey && e.key === "ArrowLeft") {
            e.preventDefault();
            setCursor((c) => Math.max(0, c - 1));
          } else if (e.altKey && e.key === "ArrowRight") {
            e.preventDefault();
            setCursor((c) => Math.min(entries.length, c + 1));
          }
        }}
        placeholder={isFirst ? "Shot prompt" : "Additional shot prompt"}
        className={`min-h-[120px] w-full resize-none bg-inset text-text p-prompt-panel outline-none ${
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
