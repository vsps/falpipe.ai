import type { GalleryColumn as GalleryColumnData } from "../lib/types";
import type { ImageAction } from "../lib/actions";
import { IconBtn } from "./IconBtn";
import { Thumbnail } from "./Thumbnail";
import { useSessionStore } from "../stores/sessionStore";
import { basename } from "../lib/paths";

type Props = {
  column: GalleryColumnData;
  width: number;
  onFolderDelete: () => void;
  onImageAction: (action: ImageAction, imagePath: string) => void;
  onRefresh?: () => void;
};

export function GalleryColumn({ column, width, onFolderDelete, onImageAction, onRefresh }: Props) {
  const { targetVersion, setTargetVersion, selectedImagePath, traceActive } = useSessionStore();

  const isTarget = targetVersion === column.version;
  const headerClass = isTarget
    ? "bg-accent text-text"
    : column.isSrc
    ? "bg-surface text-text"
    : "accent-hover text-text";

  return (
    <div
      className="bg-surface p-gallery-column flex flex-col gap-gallery-column-gap shrink-0 h-full min-h-0"
      style={{ width: `${width}px` }}
    >
      <div
        className={`flex items-center h-[25px] px-[5px] text-sm cursor-pointer shrink-0 ${headerClass}`}
        onClick={() => !column.isSrc && setTargetVersion(column.version)}
      >
        <span className="flex-1 truncate">{column.version}</span>
        {column.isSrc && onRefresh && (
          <IconBtn
            name="refresh"
            size={18}
            title="Refresh"
            onClick={(e) => {
              e.stopPropagation();
              onRefresh();
            }}
          />
        )}
        {!column.isSrc && (
          <IconBtn
            name="delete"
            size={18}
            title="Delete version folder"
            onClick={(e) => {
              e.stopPropagation();
              onFolderDelete();
            }}
          />
        )}
      </div>
      <div className="flex-1 min-h-0 flex flex-col gap-gallery-column-gap overflow-y-auto thin-scroll pr-[3px]">
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
