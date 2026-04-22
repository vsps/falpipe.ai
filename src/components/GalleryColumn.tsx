import type { GalleryColumn as GalleryColumnData } from "../lib/types";
import { IconBtn } from "./IconBtn";
import { Thumbnail } from "./Thumbnail";
import { useSessionStore } from "../stores/sessionStore";
import { basename } from "../lib/paths";

type Props = {
  column: GalleryColumnData;
  onFolderDelete: () => void;
  onImageAction: (action: ImageAction, imagePath: string) => void;
};

export type ImageAction =
  | "zoom"
  | "select"
  | "add_to_refs"
  | "copy_settings"
  | "copy_prompt"
  | "trace"
  | "delete";

export function GalleryColumn({ column, onFolderDelete, onImageAction }: Props) {
  const { targetVersion, setTargetVersion, selectedImagePath, traceActive } = useSessionStore();

  const isTarget = targetVersion === column.version;
  const headerClass = isTarget
    ? "bg-accent text-text"
    : column.isSrc
    ? "bg-surface text-text"
    : "bg-surface text-text hover:bg-panel";

  return (
    <div className="bg-surface p-[6px] flex flex-col gap-[5px] w-[180px] shrink-0 h-full min-h-0">
      <div
        className={`flex items-center h-[25px] px-[5px] text-sm cursor-pointer shrink-0 ${headerClass}`}
        onClick={() => !column.isSrc && setTargetVersion(column.version)}
      >
        <span className="flex-1 truncate">{column.version}</span>
        {!column.isSrc && (
          <IconBtn
            name="folder_delete"
            size={18}
            title="Delete version folder"
            onClick={(e) => {
              e.stopPropagation();
              onFolderDelete();
            }}
          />
        )}
      </div>
      <div className="flex-1 min-h-0 flex flex-col gap-[5px] overflow-y-auto thin-scroll pr-[3px]">
        {column.images.map((img) => {
          const inTrace = traceActive ? traceActive.traceSet.has(img.path) : true;
          return (
            <Thumbnail
              key={img.path}
              image={img}
              selected={selectedImagePath === img.path}
              hidden={!inTrace}
              traceActive={traceActive?.imagePath === img.path}
              onSelect={() => onImageAction("select", img.path)}
              onZoom={() => onImageAction("zoom", img.path)}
              onAddToRefs={() => onImageAction("add_to_refs", img.path)}
              onCopySettings={() => onImageAction("copy_settings", img.path)}
              onCopyPrompt={() => onImageAction("copy_prompt", img.path)}
              onTrace={() => onImageAction("trace", img.path)}
              onDelete={() => onImageAction("delete", img.path)}
            />
          );
        })}
        {column.images.length === 0 && (
          <div className="text-xs text-dim text-center py-2">
            {column.isSrc ? "No refs" : "Empty"}
          </div>
        )}
      </div>
      {/* small footer showing column file path */}
      <div className="text-[10px] text-dim font-mono truncate" title={column.id}>
        {basename(column.id)}
      </div>
    </div>
  );
}
