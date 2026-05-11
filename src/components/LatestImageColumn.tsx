import { useMemo, useState } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { fileSrc } from "../lib/assets";
import { PathContextMenu } from "./PathContextMenu";
import type { GalleryImage, GalleryColumn } from "../lib/types";

/**
 * Fills remaining horizontal space between RefImages and Run. Shows the
 * current selection, or the last image in the target version (i.e. the most
 * recent generation). Videos render with native controls.
 */
export function LatestImageColumn() {
  const columns = useSessionStore((s) => s.columns);
  const selectedImagePath = useSessionStore((s) => s.selectedImagePath);
  const targetVersion = useSessionStore((s) => s.targetVersion);
  const image = useMemo(
    () => pickImage(columns, selectedImagePath, targetVersion),
    [columns, selectedImagePath, targetVersion],
  );
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  const onCtx = (e: React.MouseEvent) => {
    if (!image) return;
    e.preventDefault();
    setMenuPos({ x: e.clientX, y: e.clientY });
  };

  return (
    <div className="bg-surface border border-border p-prompt-column text-text flex-1 min-w-0 flex flex-col gap-prompt-column-gap shrink">
      <div className="flex items-center text-sm font-semibold">
        <span>LATEST</span>
        {image && (
          <>
            <span className="flex-1" />
            <span className="text-xs opacity-60 font-mono truncate" title={image.path}>
              {image.filename}
            </span>
          </>
        )}
      </div>
      <div className="flex-1 min-h-0 bg-inset flex items-center justify-center overflow-hidden">
        {image ? (
          image.isVideo ? (
            <video
              key={image.path}
              src={fileSrc(image.path)}
              controls
              className="max-w-full max-h-full"
              onContextMenu={onCtx}
            />
          ) : (
            <img
              key={image.path}
              src={fileSrc(image.path)}
              alt={image.filename}
              className="max-w-full max-h-full object-contain"
              onContextMenu={onCtx}
            />
          )
        ) : (
          <div className="text-xs text-dim">No image</div>
        )}
      </div>
      {menuPos && image && (
        <PathContextMenu
          x={menuPos.x}
          y={menuPos.y}
          path={image.path}
          onClose={() => setMenuPos(null)}
        />
      )}
    </div>
  );
}

function pickImage(
  columns: GalleryColumn[],
  selectedImagePath: string | null,
  targetVersion: string | null,
): GalleryImage | null {
  if (selectedImagePath) {
    for (const c of columns) {
      const hit = c.images.find((i) => i.path === selectedImagePath);
      if (hit) return hit;
    }
  }
  // Fall back to the last image in the target version column.
  const target = columns.find((c) => c.version === targetVersion && !c.isSrc);
  if (target && target.images.length) return target.images[target.images.length - 1];
  // Otherwise last image in the latest non-SRC column.
  for (let i = columns.length - 1; i >= 0; i--) {
    const c = columns[i];
    if (!c.isSrc && c.images.length) return c.images[c.images.length - 1];
  }
  return null;
}
