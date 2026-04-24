import { useEffect, useRef, useState } from "react";
import type { GalleryImage } from "../lib/types";
import { IconBtn } from "./IconBtn";
import { fileSrc } from "../lib/assets";
import { PathContextMenu } from "./PathContextMenu";

type Props = {
  image: GalleryImage;
  selected: boolean;
  hidden?: boolean;
  onSelect: () => void;
  onZoom: () => void;
  onAddToRefs: () => void;
  onCopySettings: () => void;
  onCopyPrompt: () => void;
  onTrace: () => void;
  onDelete: () => void;
  traceActive?: boolean;
};

export function Thumbnail({
  image,
  selected,
  hidden,
  onSelect,
  onZoom,
  onAddToRefs,
  onCopySettings,
  onCopyPrompt,
  onTrace,
  onDelete,
  traceActive,
}: Props) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // When selection arrives via keyboard nav the thumb may be offscreen; scroll
  // it back into view. "nearest" avoids jumpy scrolls for already-visible rows.
  useEffect(() => {
    if (selected) rootRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selected]);

  if (hidden) return null;
  const srcUrl = image.isVideo ? (image.thumbPath ? fileSrc(image.thumbPath) : null) : fileSrc(image.path);

  return (
    <div
      ref={rootRef}
      className={`group relative w-full shrink-0 overflow-hidden cursor-zoom-in border ${
        selected ? "border-accent" : "border-transparent"
      } ${traceActive ? "ring-2 ring-warn" : ""} bg-bg`}
      style={{ paddingBottom: "100%" }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
        onZoom();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenuPos({ x: e.clientX, y: e.clientY });
      }}
      onMouseDown={(e) => e.stopPropagation()}
      title={image.filename}
    >
      {srcUrl ? (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url("${srcUrl}")`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
          }}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-dim text-text">
          <span className="material-symbols-outlined" style={{ fontSize: 40 }}>
            play_circle
          </span>
        </div>
      )}
      {image.isVideo && (
        <span
          className="absolute top-1 right-1 material-symbols-outlined text-text drop-shadow"
          style={{ fontSize: 18 }}
        >
          play_circle
        </span>
      )}

      {/* Action strip — top */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center gap-[2px] bg-bg/80 px-[2px] py-[1px] opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        <IconBtn name="add_photo_alternate" size={16} title="Add to refs" onClick={onAddToRefs} />
        <IconBtn name="copy_all" size={16} title="Copy all settings" onClick={onCopySettings} />
        <IconBtn name="content_copy" size={16} title="Copy prompt" onClick={onCopyPrompt} />
        <IconBtn name="conversion_path" size={16} title="Trace" onClick={onTrace} />
      </div>

      {/* Delete — bottom right */}
      <div
        className="absolute bottom-1 right-1 bg-bg/80 px-[2px] py-[1px] opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        <IconBtn name="delete" size={16} title="Delete" onClick={onDelete} />
      </div>
      {menuPos && (
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
