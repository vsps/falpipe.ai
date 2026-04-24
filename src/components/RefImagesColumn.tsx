import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { IconBtn } from "./IconBtn";
import { RoleMenu } from "./RoleMenu";
import { useGenerationStore } from "../stores/generationStore";
import { useSessionStore } from "../stores/sessionStore";
import { fileSrc } from "../lib/assets";
import { basename } from "../lib/paths";
import { pickFile, showMessage } from "../lib/dialog";
import { cmd } from "../lib/tauri";
import { performImageAction } from "../lib/actions";
import type { RefImage, RoleAssignment } from "../lib/types";

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"];

function isImage(path: string): boolean {
  const ext = path.toLowerCase().split(".").pop();
  return !!ext && IMAGE_EXTS.includes(ext);
}

export function RefImagesColumn() {
  const { currentModel, refImages, addRefs, removeRef, removeAllRefs, assignRole, reorderRefs } =
    useGenerationStore();

  const [menu, setMenu] = useState<{ anchor: HTMLElement; ref: RefImage } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dragState, setDragState] = useState<{ fromIdx: number; overIdx: number | null } | null>(
    null,
  );
  const panelRef = useRef<HTMLDivElement>(null);

  async function ingestPaths(paths: string[]) {
    // Read shotPath fresh each call — the Tauri drop listener is registered
    // once for the component lifetime, so we can't rely on a closed-over value.
    const shotPath = useSessionStore.getState().shotPath;
    if (!shotPath) {
      await showMessage("Open a shot first", { kind: "warning" });
      return;
    }
    const images = paths.filter(isImage);
    if (images.length === 0) return;
    const copied: string[] = [];
    for (const p of images) {
      try {
        const dest = await cmd.ref_copy_to_src(shotPath, p);
        copied.push(dest);
      } catch (e) {
        await showMessage(`Failed to add ${basename(p)}: ${e}`, { kind: "error" });
      }
    }
    if (copied.length) addRefs(copied);
  }

  async function onAdd() {
    const paths = await pickFile("Pick reference images", {
      extensions: IMAGE_EXTS,
      multiple: true,
    });
    if (!paths) return;
    await ingestPaths(paths);
  }

  // Tauri-level OS file drop. Registered once. `disposed` guards against the
  // cleanup firing before onDragDropEvent's promise resolves — otherwise the
  // real listener leaks and stale handlers stack up on every shot change.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    const hitTest = (x: number, y: number): boolean => {
      const el = panelRef.current;
      if (!el) return false;
      const dpr = window.devicePixelRatio || 1;
      const r = el.getBoundingClientRect();
      const cx = x / dpr;
      const cy = y / dpr;
      return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
    };
    getCurrentWebview()
      .onDragDropEvent(async (event) => {
        const p = event.payload;
        if (p.type === "enter" || p.type === "over") {
          setDragOver(hitTest(p.position.x, p.position.y));
        } else if (p.type === "leave") {
          setDragOver(false);
        } else if (p.type === "drop") {
          const inside = hitTest(p.position.x, p.position.y);
          setDragOver(false);
          if (inside) await ingestPaths(p.paths);
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch((e) => console.error("onDragDropEvent registration failed:", e));
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Intra-app drag-to-reorder. The white bar on each thumb is the handle
  // (image body stays as a zoom target). Pointer events so it coexists with
  // Tauri's OS file-drop (HTML5 drag is blocked on Windows when dragDropEnabled=true).
  function beginHandleDrag(fromIdx: number, pointerId: number, handleEl: HTMLElement) {
    handleEl.setPointerCapture(pointerId);
    setDragState({ fromIdx, overIdx: null });
    let currentOver: number | null = null;

    const findIdxAt = (x: number, y: number): number | null => {
      const el = document.elementFromPoint(x, y);
      if (!el) return null;
      const thumb = el.closest<HTMLElement>("[data-ref-idx]");
      if (!thumb) return null;
      const n = Number(thumb.dataset.refIdx);
      return Number.isFinite(n) ? n : null;
    };

    const onMove = (ev: PointerEvent) => {
      const idx = findIdxAt(ev.clientX, ev.clientY);
      currentOver = idx;
      setDragState({ fromIdx, overIdx: idx });
    };
    const onUp = () => {
      handleEl.releasePointerCapture(pointerId);
      handleEl.removeEventListener("pointermove", onMove);
      handleEl.removeEventListener("pointerup", onUp);
      handleEl.removeEventListener("pointercancel", onUp);
      setDragState(null);
      if (currentOver != null && currentOver !== fromIdx) {
        reorderRefs(fromIdx, currentOver);
      }
    };
    handleEl.addEventListener("pointermove", onMove);
    handleEl.addEventListener("pointerup", onUp);
    handleEl.addEventListener("pointercancel", onUp);
  }

  return (
    <>
      <div
        ref={panelRef}
        className={`bg-surface p-prompt-column text-text w-[381px] flex flex-col gap-prompt-column-gap shrink-0 transition-colors ${
          dragOver ? "outline outline-2 outline-accent" : ""
        }`}
      >
        <div className="flex items-center text-sm font-semibold">
          <span>REF_IMAGES</span>
          <span className="flex-1" />
          <span className="text-xs opacity-60 font-mono">{refImages.length}</span>
        </div>
        <div className="flex flex-wrap gap-prompt-column-gap content-start overflow-y-auto thin-scroll bg-inset p-prompt-panel flex-1 min-h-0">
          {refImages.map((r, idx) => (
            <RefThumb
              key={r.path}
              index={idx}
              ref_={r}
              isDragging={dragState?.fromIdx === idx}
              isDropTarget={dragState != null && dragState.overIdx === idx && dragState.fromIdx !== idx}
              onRemove={() => removeRef(r.path)}
              onOpenMenu={(anchor) => setMenu({ anchor, ref: r })}
              onZoom={() => void performImageAction("zoom", r.path)}
              onHandlePointerDown={(pointerId, handleEl) => beginHandleDrag(idx, pointerId, handleEl)}
            />
          ))}
          <RefAddTile onAdd={onAdd} onRemoveAll={removeAllRefs} canRemove={refImages.length > 0} />
        </div>
      </div>

      {menu && (
        <RoleMenu
          anchor={menu.anchor}
          ref_={menu.ref}
          model={currentModel}
          onAssign={(role: RoleAssignment | null) => {
            assignRole(menu.ref.path, role);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

function RefThumb({
  index,
  ref_,
  isDragging,
  isDropTarget,
  onRemove,
  onOpenMenu,
  onZoom,
  onHandlePointerDown,
}: {
  index: number;
  ref_: RefImage;
  isDragging: boolean;
  isDropTarget: boolean;
  onRemove: () => void;
  onOpenMenu: (anchor: HTMLElement) => void;
  onZoom: () => void;
  onHandlePointerDown: (pointerId: number, handleEl: HTMLElement) => void;
}) {
  const label = roleLabel(ref_);

  return (
    <div
      data-ref-idx={index}
      className={`relative bg-bg text-text overflow-hidden w-[109px] h-[109px] flex flex-col justify-between p-[3px] group ${
        isDragging ? "opacity-40" : ""
      } ${isDropTarget ? "outline outline-2 outline-accent" : ""}`}
      style={{
        backgroundImage: `url(${fileSrc(ref_.path)})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      {/* Top bar = role label + role-menu trigger (click anywhere on the bar). */}
      <div
        className="relative z-10 flex items-start bg-bg/90 hover:bg-bg px-1 text-xs leading-tight truncate max-w-full cursor-pointer"
        title="Click to change role"
        onClick={(e) => {
          e.stopPropagation();
          onOpenMenu(e.currentTarget);
        }}
      >
        {label}
      </div>

      {/* Click body to zoom */}
      <div
        className="absolute inset-0 cursor-zoom-in"
        onClick={onZoom}
        title={ref_.path}
      />

      <div
        className="relative flex items-center gap-[3px] bg-bg/85 px-[2px] py-[1px] cursor-grab active:cursor-grabbing select-none"
        title="Drag to reorder"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          // Don't initiate drag if the press landed on an icon button.
          const tgt = e.target as HTMLElement;
          if (tgt.closest("button")) return;
          e.preventDefault();
          onHandlePointerDown(e.pointerId, e.currentTarget);
        }}
      >
        <IconBtn name="close" size={18} title="Remove" onClick={(e) => { e.stopPropagation(); onRemove(); }} />
        <div className="flex-1" />
        <span
          aria-hidden
          className="material-symbols-outlined opacity-60 pointer-events-none"
          style={{ fontSize: 18 }}
        >
          drag_indicator
        </span>
      </div>
    </div>
  );
}

function RefAddTile({
  onAdd,
  onRemoveAll,
  canRemove,
}: {
  onAdd: () => void;
  onRemoveAll: () => void;
  canRemove: boolean;
}) {
  return (
    <div className="bg-surface w-[109px] h-[109px] flex items-center justify-center gap-[6px]">
      <IconBtn name="add_photo_alternate" size={28} title="Add reference images" onClick={onAdd} />
      <IconBtn
        name="remove"
        size={28}
        title="Remove all references"
        onClick={onRemoveAll}
        disabled={!canRemove}
      />
    </div>
  );
}

function roleLabel(r: RefImage): string {
  const a = r.roleAssignment;
  if (!a) return basename(r.path);
  switch (a.kind) {
    case "source": return "source";
    case "start": return "start";
    case "end": return "end";
    case "element": return `@Element${a.groupName}${a.frontal ? " ★" : ""}`;
  }
}
