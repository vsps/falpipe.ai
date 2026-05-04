import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { performImageAction, type ImageAction } from "../lib/actions";

type AvailableAction = Exclude<ImageAction, "select">;

type Props = {
  x: number;
  y: number;
  path: string;
  onClose: () => void;
  // Which items to show, in order. Default: all.
  items?: AvailableAction[];
};

const DEFAULT_ITEMS: AvailableAction[] = [
  "add_to_refs",
  "copy_to_seq_src",
  "copy_to_shot_src",
  "copy_path",
  "copy_image",
  "copy_prompt",
  "copy_settings",
  "trace",
  "zoom",
  "refresh",
  "open_location",
  "delete",
];

const LABELS: Record<AvailableAction, string> = {
  add_to_refs: "Add to references",
  copy_to_seq_src: "Copy to SEQ/SRC",
  copy_to_shot_src: "Copy to SHOT/SRC",
  copy_path: "Copy path",
  copy_image: "Copy image",
  copy_prompt: "Copy prompt",
  copy_settings: "Reuse settings",
  trace: "Trace origins",
  zoom: "Zoom",
  refresh: "Refresh",
  open_location: "Open location",
  delete: "Delete",
};

// Right-click menu for any gallery/preview image. Covers the full image-op
// surface so keyboard-free workflows don't have to hunt for toolbar icons.
export function PathContextMenu({
  x,
  y,
  path,
  onClose,
  items = DEFAULT_ITEMS,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: x,
    top: y,
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 4;
    const left = Math.min(x, window.innerWidth - r.width - pad);
    const top = Math.min(y, window.innerHeight - r.height - pad);
    setPos({ left: Math.max(pad, left), top: Math.max(pad, top) });
  }, [x, y]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", down);
    window.addEventListener("contextmenu", down);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("contextmenu", down);
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  const run = (action: AvailableAction) => async (e: React.MouseEvent) => {
    e.stopPropagation();
    onClose();
    await performImageAction(action, path);
  };

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-panel text-text border border-dim shadow-xl py-0.5 text-xs"
      style={{ left: pos.left, top: pos.top }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((a) => (
        <button
          key={a}
          type="button"
          onClick={run(a)}
          className="w-full text-left px-1.5 py-[2px] hover:bg-accent"
        >
          {LABELS[a]}
        </button>
      ))}
    </div>
  );
}
