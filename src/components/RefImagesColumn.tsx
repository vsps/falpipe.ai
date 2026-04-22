import { useRef, useState } from "react";
import { IconBtn } from "./IconBtn";
import { RoleMenu } from "./RoleMenu";
import { useGenerationStore } from "../stores/generationStore";
import { useSessionStore } from "../stores/sessionStore";
import { fileSrc } from "../lib/assets";
import { basename } from "../lib/paths";
import { pickFile, showMessage } from "../lib/dialog";
import { cmd } from "../lib/tauri";
import type { RefImage, RoleAssignment } from "../lib/types";

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp"];

export function RefImagesColumn({ onZoom }: { onZoom?: (path: string) => void }) {
  const { currentModel, refImages, addRefs, removeRef, removeAllRefs, assignRole } =
    useGenerationStore();
  const { shotPath } = useSessionStore();

  const [menu, setMenu] = useState<{ anchor: HTMLElement; ref: RefImage } | null>(null);

  async function onAdd() {
    if (!shotPath) {
      await showMessage("Open a shot first", { kind: "warning" });
      return;
    }
    const paths = await pickFile("Pick reference images", {
      extensions: IMAGE_EXTS,
      multiple: true,
    });
    if (!paths) return;
    const copied: string[] = [];
    for (const p of paths) {
      try {
        const dest = await cmd.ref_copy_to_src(shotPath, p);
        copied.push(dest);
      } catch (e) {
        await showMessage(`Failed to add ${basename(p)}: ${e}`, { kind: "error" });
      }
    }
    if (copied.length) addRefs(copied);
  }

  return (
    <>
      <div className="bg-surface p-[10px] text-text flex-1 min-w-[260px] max-w-[560px] flex flex-col gap-[8px] shrink-0">
        <div className="flex items-center text-sm font-semibold">
          <span>REF_IMAGES</span>
          <span className="flex-1" />
          <span className="text-xs opacity-60 font-mono">{refImages.length}</span>
        </div>
        <div className="flex flex-wrap gap-[8px] content-start overflow-y-auto thin-scroll bg-inset p-[6px] flex-1 min-h-0">
          {refImages.map((r) => (
            <RefThumb
              key={r.path}
              ref_={r}
              onRemove={() => removeRef(r.path)}
              onOpenMenu={(anchor) => setMenu({ anchor, ref: r })}
              onZoom={() => onZoom?.(r.path)}
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
  ref_,
  onRemove,
  onOpenMenu,
  onZoom,
}: {
  ref_: RefImage;
  onRemove: () => void;
  onOpenMenu: (anchor: HTMLElement) => void;
  onZoom: () => void;
}) {
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const label = roleLabel(ref_);

  return (
    <div
      className="relative bg-bg text-text overflow-hidden w-[109px] h-[109px] flex flex-col justify-between p-[3px] group"
      style={{
        backgroundImage: `url(${fileSrc(ref_.path)})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="flex items-start bg-bg/90 px-1 text-xs leading-tight truncate max-w-full">
        {label}
      </div>

      {/* Click body to zoom */}
      <div
        className="absolute inset-0 cursor-zoom-in"
        onClick={onZoom}
        title={ref_.path}
      />

      <div className="relative flex items-center gap-[3px] bg-bg/85 px-[2px] py-[1px]">
        <IconBtn name="close" size={18} title="Remove" onClick={(e) => { e.stopPropagation(); onRemove(); }} />
        <div className="flex-1" />
        <button
          type="button"
          ref={menuBtnRef}
          title="Role"
          className="inline-flex items-center justify-center opacity-80 hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onOpenMenu(menuBtnRef.current!);
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
            settings
          </span>
        </button>
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
    case "element": return `@${a.groupName}${a.frontal ? " ★" : ""}`;
  }
}
