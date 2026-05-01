import { useState } from "react";
import { IconBtn } from "./IconBtn";
import { InlinePrompt } from "./InlinePrompt";
import { useSessionStore } from "../stores/sessionStore";
import { pickDirectory, showMessage } from "../lib/dialog";
import { basename } from "../lib/paths";

type Props = {
  onOpenSettings?: () => void;
};

export function SessionBar({ onOpenSettings }: Props) {
  const {
    projectPath,
    sequencePath,
    shotPath,
    sequencesInProject,
    shotsInSequence,
    setProject,
    setSequence,
    setShot,
    createSequence,
    createShot,
  } = useSessionStore();

  const [creating, setCreating] = useState<null | "sequence" | "shot">(null);

  async function pickProject() {
    const p = await pickDirectory("Choose project directory", projectPath ?? undefined);
    if (!p) return;
    try {
      await setProject(p);
    } catch (e) {
      const msg = String(e);
      await showMessage(msg.includes("NOT A PROJECT FOLDER") ? "NOT A PROJECT FOLDER" : msg, { kind: "error" });
    }
  }

  async function onCreateSequence(name: string) {
    setCreating(null);
    try {
      await createSequence(name);
    } catch (e) {
      await showMessage(String(e), { kind: "error" });
    }
  }

  async function onCreateShot(name: string) {
    setCreating(null);
    try {
      await createShot(name);
    } catch (e) {
      await showMessage(String(e), { kind: "error" });
    }
  }

  return (
    <div className="flex items-center gap-[5px] text-sm">
      <div className="flex flex-1 items-center gap-[6px] min-w-0 bg-panel px-[5px] py-[5px]">
        {/* PROJECT */}
        <span>PROJECT DIR:</span>
        <IconBtn name="folder_open" size={22} title="Pick project directory" onClick={pickProject} />
        <Pill
          value={projectPath ?? "—"}
          truncate
          onClick={pickProject}
          title={projectPath ?? "No project"}
        />

        {/* SEQUENCE */}
        <span className="pl-2">SEQUENCE</span>
        {creating === "sequence" ? (
          <InlinePrompt
            placeholder="sequence name"
            onConfirm={onCreateSequence}
            onCancel={() => setCreating(null)}
          />
        ) : (
          <PathSelect
            value={sequencePath}
            options={sequencesInProject}
            onChange={(p) => void setSequence(p)}
            disabled={!projectPath}
            placeholder={projectPath ? "— select —" : "pick project first"}
          />
        )}
        <IconBtn
          name="add"
          size={20}
          title="Create sequence"
          onClick={() => {
            if (!projectPath) {
              void showMessage("Pick a project first", { kind: "warning" });
              return;
            }
            setCreating("sequence");
          }}
          disabled={!projectPath}
        />

        {/* SHOT */}
        <span className="pl-2">SHOT:</span>
        {creating === "shot" ? (
          <InlinePrompt
            placeholder="shot name"
            onConfirm={onCreateShot}
            onCancel={() => setCreating(null)}
          />
        ) : (
          <PathSelect
            value={shotPath}
            options={shotsInSequence}
            onChange={(p) => void setShot(p)}
            disabled={!sequencePath}
            placeholder={sequencePath ? "— select —" : "pick sequence first"}
          />
        )}
        <IconBtn
          name="add"
          size={20}
          title="Create shot"
          onClick={() => {
            if (!sequencePath) {
              void showMessage("Pick a sequence first", { kind: "warning" });
              return;
            }
            setCreating("shot");
          }}
          disabled={!sequencePath}
        />
      </div>

      <IconBtn name="settings" size={24} title="Settings" onClick={onOpenSettings} />
    </div>
  );
}

function PathSelect({
  value,
  options,
  onChange,
  disabled,
  placeholder,
}: {
  value: string | null;
  options: string[];
  onChange: (path: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <select
      className="bg-bg text-text px-2 py-[2px] min-w-[140px] max-w-[260px] disabled:opacity-50"
      value={value ?? ""}
      onChange={(e) => {
        const v = e.currentTarget.value;
        if (v) onChange(v);
      }}
      disabled={disabled}
    >
      <option value="">{placeholder ?? "— select —"}</option>
      {options.map((p) => (
        <option key={p} value={p}>
          {basename(p)}
        </option>
      ))}
    </select>
  );
}

function Pill({
  value,
  title,
  truncate,
  onClick,
}: {
  value: string;
  title?: string;
  truncate?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className={`bg-bg text-text px-2 py-[2px] whitespace-nowrap ${
        truncate ? "flex-1 min-w-0 overflow-hidden text-ellipsis" : ""
      } ${onClick ? "cursor-pointer" : ""}`}
      title={title ?? value}
      onClick={onClick}
    >
      {value || "—"}
    </div>
  );
}
