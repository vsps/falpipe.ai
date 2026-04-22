import { useState } from "react";
import type { GalleryImage } from "../lib/types";
import { GalleryColumn, type ImageAction } from "./GalleryColumn";
import { ImageZoomModal } from "./ImageZoomModal";
import { IconBtn } from "./IconBtn";
import { useSessionStore } from "../stores/sessionStore";
import {
  addImageToRefs,
  computeTraceSet,
  copyPromptFromMetadata,
  copySettingsFromMetadata,
} from "../lib/actions";
import { cmd } from "../lib/tauri";
import { confirmAction, showMessage } from "../lib/dialog";

export function Gallery() {
  const session = useSessionStore();
  const { columns, traceActive } = session;
  const [zoomPath, setZoomPath] = useState<string | null>(null);

  const flatImages = columns.flatMap((c) => c.images);
  const zoomImage = zoomPath ? flatImages.find((i) => i.path === zoomPath) ?? null : null;

  async function onImageAction(action: ImageAction, path: string) {
    const img = flatImages.find((i) => i.path === path);
    switch (action) {
      case "select":
        session.setSelectedImage(path);
        return;
      case "zoom":
        session.setSelectedImage(path);
        setZoomPath(path);
        return;
      case "add_to_refs":
        try {
          await addImageToRefs(path);
        } catch (e) {
          await showMessage(String(e), { kind: "error" });
        }
        return;
      case "copy_settings": {
        const meta = (await cmd.image_metadata_read(path).catch(() => null)) as
          | import("../lib/types").ImageMetadata
          | null;
        if (!meta) {
          await showMessage("No metadata for this image", { kind: "warning" });
          return;
        }
        const { skippedRefs } = await copySettingsFromMetadata(meta);
        if (skippedRefs) {
          await showMessage(`Loaded. ${skippedRefs} ref(s) skipped (files missing).`, {
            kind: "info",
          });
        }
        return;
      }
      case "copy_prompt": {
        const meta = (await cmd.image_metadata_read(path).catch(() => null)) as
          | import("../lib/types").ImageMetadata
          | null;
        if (!meta) {
          await showMessage("No metadata for this image", { kind: "warning" });
          return;
        }
        copyPromptFromMetadata(meta);
        return;
      }
      case "trace": {
        if (traceActive?.imagePath === path) {
          session.setTrace(null);
          return;
        }
        const set = await computeTraceSet(path);
        session.setTrace({ imagePath: path, traceSet: set });
        return;
      }
      case "delete": {
        const ok = await confirmAction(`Delete ${img?.filename}?`, {
          title: "Delete image",
          kind: "warning",
        });
        if (!ok) return;
        try {
          await cmd.image_delete(path);
          await session.rescanShot();
          if (zoomPath === path) setZoomPath(null);
        } catch (e) {
          await showMessage(String(e), { kind: "error" });
        }
        return;
      }
    }
  }

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
    <div className="flex flex-1 min-h-0 gap-[5px] bg-panel">
      {traceActive && (
        <div className="absolute top-[80px] right-2 z-10 bg-warn/90 text-text px-2 py-1 text-xs font-mono">
          tracing · {traceActive.traceSet.size} images ·{" "}
          <button className="underline" onClick={() => session.setTrace(null)}>
            exit (Esc)
          </button>
        </div>
      )}
      <div className="flex flex-1 gap-[5px] overflow-x-auto overflow-y-hidden thin-scroll min-h-0">
        {columns.length === 0 ? (
          <div className="text-sm text-dim p-4">Open a shot to see its versions.</div>
        ) : (
          columns.map((c) => (
            <GalleryColumn
              key={c.version}
              column={c}
              onFolderDelete={() => onFolderDelete(c.version)}
              onImageAction={onImageAction}
            />
          ))
        )}
      </div>
      {session.shotPath && (
        <button
          className="bg-surface px-3 py-2 flex items-center justify-center"
          title="Add new version"
          onClick={onAddNewVersion}
        >
          <IconBtn name="add" size={22} />
        </button>
      )}

      {zoomImage && (
        <ImageZoomModal
          image={zoomImage}
          onClose={() => setZoomPath(null)}
          onAddToRefs={async () => {
            try { await addImageToRefs(zoomImage.path); } catch (e) { await showMessage(String(e), { kind: "error" }); }
          }}
          onCopySettings={async () => onImageAction("copy_settings", zoomImage.path)}
          onCopyPrompt={async () => onImageAction("copy_prompt", zoomImage.path)}
          onTrace={async () => onImageAction("trace", zoomImage.path)}
          onDelete={async () => onImageAction("delete", zoomImage.path)}
        />
      )}
    </div>
  );
}

// Side-effect free check the linter insists on.
export type { GalleryImage };
