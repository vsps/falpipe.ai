import { useEffect, useRef, useState } from "react";
import type { ModelNode, RefImage, RoleAssignment } from "../lib/types";

type Props = {
  anchor: HTMLElement | null;
  ref_: RefImage;
  model: ModelNode | null;
  onAssign: (role: RoleAssignment | null) => void;
  onClose: () => void;
};

function rolesSupportedBy(model: ModelNode | null): {
  source: boolean;
  start: boolean;
  end: boolean;
  element: boolean;
} {
  const has = (name: string) =>
    !!model?.ref_roles?.some((r) => r.role === name);
  return {
    source: has("source"),
    start: has("start"),
    end: has("end"),
    element: has("element"),
  };
}

export function RoleMenu({ anchor, ref_, model, onAssign, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [groupName, setGroupName] = useState(
    ref_.roleAssignment?.kind === "element" ? ref_.roleAssignment.groupName : "",
  );
  const [frontal, setFrontal] = useState(
    ref_.roleAssignment?.kind === "element" ? ref_.roleAssignment.frontal : false,
  );
  const supported = rolesSupportedBy(model);
  const anyRole = supported.source || supported.start || supported.end || supported.element;

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  // Position near anchor.
  const rect = anchor?.getBoundingClientRect();
  const style = rect
    ? {
        left: Math.max(8, rect.left),
        top: rect.bottom + 4,
      }
    : { left: 100, top: 100 };

  return (
    <div
      ref={menuRef}
      className="fixed z-30 bg-panel text-text border border-dim shadow-xl p-2 w-[220px] flex flex-col gap-1 text-sm"
      style={style}
    >
      <div className="text-xs opacity-60 mb-1">Role</div>
      {!anyRole && (
        <div className="text-xs text-dim px-1">No roles for this model.</div>
      )}
      {supported.source && (
        <RoleOption
          label="source"
          active={ref_.roleAssignment?.kind === "source"}
          onClick={() => onAssign({ kind: "source" })}
        />
      )}
      {supported.start && (
        <RoleOption
          label="start frame (exclusive)"
          active={ref_.roleAssignment?.kind === "start"}
          onClick={() => onAssign({ kind: "start" })}
        />
      )}
      {supported.end && (
        <RoleOption
          label="end frame (exclusive)"
          active={ref_.roleAssignment?.kind === "end"}
          onClick={() => onAssign({ kind: "end" })}
        />
      )}
      {supported.element && (
        <div className="flex flex-col gap-1 border-t border-dim pt-1 mt-1">
          <div className="text-xs opacity-60">element</div>
          <input
            type="text"
            value={groupName}
            onChange={(e) => setGroupName(e.currentTarget.value)}
            placeholder="group name"
            className="bg-bg text-text px-1 py-[2px] outline-none"
          />
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              checked={frontal}
              onChange={(e) => setFrontal(e.currentTarget.checked)}
              className="accent-accent"
            />
            frontal
          </label>
          <button
            className="bg-accent text-text px-2 py-[2px] mt-1 disabled:opacity-40"
            disabled={!groupName.trim()}
            onClick={() =>
              onAssign({ kind: "element", groupName: groupName.trim(), frontal })
            }
          >
            assign
          </button>
        </div>
      )}
      <button
        className="mt-2 text-xs text-accent hover:underline text-left"
        onClick={() => onAssign(null)}
      >
        clear role
      </button>
    </div>
  );
}

function RoleOption({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left px-2 py-[3px] rounded ${
        active ? "bg-accent text-text" : "hover:bg-panel"
      }`}
    >
      {label}
    </button>
  );
}
