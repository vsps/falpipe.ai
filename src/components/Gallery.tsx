import { useEffect } from "react";
import type { GalleryImage } from "../lib/types";
import { GalleryColumn } from "./GalleryColumn";
import { ImageZoomModal } from "./ImageZoomModal";
import { IconBtn } from "./IconBtn";
import { ResizeBar } from "./ResizeBar";
import { useSessionStore } from "../stores/sessionStore";
import { performImageAction, type ImageAction } from "../lib/actions";
import { cmd } from "../lib/tauri";
import { basename } from "../lib/paths";
import { confirmAction, showMessage } from "../lib/dialog";

const VIDEO_EXTS = ["mp4", "webm", "mov", "mkv"];

// Build a minimal GalleryImage for paths that aren't in the scanned columns
// (e.g. a ref image added mid-session before the next rescan).
function syntheticImage(path: string): GalleryImage {
  const filename = basename(path);
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return {
    filename,
    path,
    metadataPath: "",
    isVideo: VIDEO_EXTS.includes(ext),
  };
}

export function Gallery() {
  const session = useSessionStore();
  const {
    columns,
    traceActive,
    thumbColWidth,
    setThumbColWidth,
    zoomImagePath,
    setZoomImage,
  } = session;

  const flatImages = columns.flatMap((c) => c.images);
  const zoomImage = zoomImagePath
    ? flatImages.find((i) => i.path === zoomImagePath) ?? syntheticImage(zoomImagePath)
    : null;

  const onImageAction = (action: ImageAction, path: string) =>
    performImageAction(action, path);

  // Grid keyboard nav. Arrow keys traverse the 2D gallery (columns × images).
  // Left/Right across columns keeping the row index; Up/Down within a column.
  // Skipped while typing in inputs or while the zoom modal owns arrows.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key !== "ArrowLeft" &&
        e.key !== "ArrowRight" &&
        e.key !== "ArrowUp" &&
        e.key !== "ArrowDown"
      )
        return;
      if (zoomImagePath) return;
      const tgt = e.target as HTMLElement | null;
      const tag = tgt?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tgt?.isContentEditable) return;
      if (columns.every((c) => c.images.length === 0)) return;

      e.preventDefault();
      const selected = session.selectedImagePath;
      let colIdx = selected
        ? columns.findIndex((c) => c.images.some((i) => i.path === selected))
        : -1;
      let rowIdx = -1;
      if (colIdx >= 0 && selected) {
        rowIdx = columns[colIdx].images.findIndex((i) => i.path === selected);
      }

      // No current selection → first image of first non-empty column.
      if (colIdx < 0 || rowIdx < 0) {
        const firstCol = columns.findIndex((c) => c.images.length > 0);
        if (firstCol < 0) return;
        session.setSelectedImage(columns[firstCol].images[0].path);
        return;
      }

      if (e.key === "ArrowUp") {
        if (rowIdx > 0) rowIdx -= 1;
      } else if (e.key === "ArrowDown") {
        if (rowIdx < columns[colIdx].images.length - 1) rowIdx += 1;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        // Walk to the next non-empty column in the chosen direction.
        let nc = colIdx + dir;
        while (nc >= 0 && nc < columns.length && columns[nc].images.length === 0) nc += dir;
        if (nc < 0 || nc >= columns.length) return;
        colIdx = nc;
        rowIdx = Math.min(rowIdx, columns[colIdx].images.length - 1);
      }

      const next = columns[colIdx].images[rowIdx];
      if (next) session.setSelectedImage(next.path);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [columns, zoomImagePath, session]);

  async function onFolderDelete(version: string) {
    const col = columns.find((c) => c.version === version);
    if (!col || col.isSrc) return;
    const shotPath = session.shotPath;
    if (!shotPath) return;
    const ok = await confirmAction(`Delete version folder ${version} and all its images?`, {
      title: "Delete column",
      kind: "warning",
    });
    if (!ok) return;
    try {
      await cmd.column_delete(`${shotPath}/${version}`);
      await session.rescanShot();
    } catch (e) {
      await showMessage(String(e), { kind: "error" });
    }
  }

  async function onAddNewVersion() {
    try {
      await session.createNextVersion();
    } catch (e) {
      await showMessage(String(e), { kind: "error" });
    }
  }

  return (
    <div className="flex flex-1 min-h-0 min-w-0 gap-gallery-surface bg-gallery-surface">
      {traceActive && (
        <div className="absolute top-[80px] right-2 z-10 bg-warn/90 text-text px-2 py-1 text-xs font-mono">
          tracing · {traceActive.traceSet.size} images ·{" "}
          <button className="underline" onClick={() => session.setTrace(null)}>
            exit (Esc)
          </button>
        </div>
      )}
      <div className="flex flex-1 min-w-0 gap-gallery-surface overflow-x-auto overflow-y-hidden thin-scroll min-h-0">
        {columns.length === 0 ? (
          <div className="text-sm text-dim p-4">Open a shot to see its versions.</div>
        ) : (
          <>
            {columns.map((c) => (
              <GalleryColumn
                key={c.version}
                column={c}
                width={thumbColWidth}
                onFolderDelete={() => onFolderDelete(c.version)}
                onImageAction={onImageAction}
                onRefresh={c.isSrc ? () => session.rescanShot() : undefined}
              />
            ))}
            {session.shotPath && (
              <button
                className="accent-hover px-3 py-2 flex items-center justify-center shrink-0"
                title="Add new version"
                onClick={onAddNewVersion}
              >
                <IconBtn name="add" size={22} />
              </button>
            )}
            <ResizeBar
              orientation="vertical"
              value={thumbColWidth}
              onChange={setThumbColWidth}
              grow="right"
            />
          </>
        )}
      </div>

      {zoomImage && (
        <ImageZoomModal
          image={zoomImage}
          onClose={() => setZoomImage(null)}
          onAddToRefs={async () => onImageAction("add_to_refs", zoomImage.path)}
          onCopySettings={async () => onImageAction("copy_settings", zoomImage.path)}
          onTrace={async () => onImageAction("trace", zoomImage.path)}
          onDelete={async () => onImageAction("delete", zoomImage.path)}
        />
      )}
    </div>
  );
}

// Side-effect free check the linter insists on.
export type { GalleryImage };
