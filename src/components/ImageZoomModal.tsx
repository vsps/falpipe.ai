import { useEffect, useState } from "react";
import type { GalleryImage, ImageMetadata } from "../lib/types";
import { fileSrc } from "../lib/assets";
import { IconBtn } from "./IconBtn";
import { cmd } from "../lib/tauri";

type Props = {
  image: GalleryImage;
  onClose: () => void;
  onAddToRefs: () => void;
  onCopySettings: () => void;
  onCopyPrompt: () => void;
  onTrace: () => void;
  onDelete: () => void;
};

export function ImageZoomModal({
  image,
  onClose,
  onAddToRefs,
  onCopySettings,
  onCopyPrompt,
  onTrace,
  onDelete,
}: Props) {
  const [fit, setFit] = useState<"fit" | "one">("fit");
  const [meta, setMeta] = useState<ImageMetadata | null>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === " ") {
        e.preventDefault();
        setFit((f) => (f === "fit" ? "one" : "fit"));
      }
    };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    cmd
      .image_metadata_read(image.path)
      .then((m) => {
        if (!cancelled) setMeta(m as ImageMetadata | null);
      })
      .catch(() => {
        if (!cancelled) setMeta(null);
      });
    return () => {
      cancelled = true;
    };
  }, [image.path]);

  const src = fileSrc(image.path);

  return (
    <div
      className="fixed inset-0 z-40 bg-black/90 flex flex-col"
      onClick={onClose}
    >
      <div className="flex-1 min-h-0 overflow-auto thin-scroll flex items-center justify-center">
        {image.isVideo ? (
          <video
            src={src}
            controls
            autoPlay
            className={fit === "fit" ? "max-h-full max-w-full" : ""}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <img
            src={src}
            alt={image.filename}
            className={fit === "fit" ? "max-h-full max-w-full object-contain" : ""}
            style={fit === "one" ? { maxWidth: "none", maxHeight: "none" } : undefined}
            onClick={(e) => {
              e.stopPropagation();
              setFit((f) => (f === "fit" ? "one" : "fit"));
            }}
          />
        )}
      </div>

      <div
        className="bg-panel text-text p-3 flex items-center gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-1 min-w-0">
          <div className="text-sm font-mono truncate" title={image.path}>
            {image.filename}
          </div>
          {meta && (
            <div className="text-xs text-dim truncate">
              {meta.model}
              {meta.iterationTotal ? ` · ${meta.iterationIndex}/${meta.iterationTotal}` : ""} ·{" "}
              {meta.timestamp}
            </div>
          )}
          {meta?.shotPrompt || meta?.prompt ? (
            <div className="text-xs truncate" title={meta.shotPrompt ?? meta.prompt ?? ""}>
              {meta.shotPrompt ?? meta.prompt}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <IconBtn name="add_photo_alternate" size={20} title="Add to refs" onClick={onAddToRefs} />
          <IconBtn name="copy_all" size={20} title="Copy all settings" onClick={onCopySettings} />
          <IconBtn name="content_copy" size={20} title="Copy prompt" onClick={onCopyPrompt} />
          <IconBtn name="conversion_path" size={20} title="Trace" onClick={onTrace} />
          <IconBtn name="delete" size={20} title="Delete" onClick={onDelete} />
          <div className="w-3" />
          <IconBtn name="close" size={24} title="Close (Esc)" onClick={onClose} />
        </div>
      </div>
    </div>
  );
}
