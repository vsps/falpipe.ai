import { useRef, useState } from "react";
import type {
  TimelineClip as TimelineClipT,
  ShotLatestMedia,
} from "../lib/types";
import { fileSrc } from "../lib/assets";
import { resolveClipMedia, useTimelineStore } from "../stores/timelineStore";
import { Icon } from "../lib/icon";
import { ClipMediaPicker } from "./ClipMediaPicker";
import { basename } from "../lib/paths";

type Props = {
  clip: TimelineClipT;
  clipIdx: number;
  isPad: boolean;
  shotsLatestMedia: Map<string, ShotLatestMedia>;
  widthPct: number;
  onReorderStart: (
    fromIdx: number,
    fromPath: string,
    startX: number,
  ) => void;
};

function videoThumbCandidate(videoPath: string): string {
  const dot = videoPath.lastIndexOf(".");
  const stem = dot >= 0 ? videoPath.slice(0, dot) : videoPath;
  return `${stem}.thumb.png`;
}

const DRAG_THRESHOLD_PX = 4;

export function TimelineClip({
  clip,
  clipIdx,
  isPad,
  shotsLatestMedia,
  widthPct,
  onReorderStart,
}: Props) {
  const resolved = resolveClipMedia(clip, shotsLatestMedia);
  const toggleClipEnabled = useTimelineStore((s) => s.toggleClipEnabled);
  const setClipMedia = useTimelineStore((s) => s.setClipMedia);

  const [thumbBroken, setThumbBroken] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const downAtRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);

  const isBlank = clip.shotPath == null;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (isPad) return;
    downAtRef.current = { x: e.clientX, y: e.clientY };
    draggingRef.current = false;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = downAtRef.current;
    if (!d || draggingRef.current) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > DRAG_THRESHOLD_PX && clip.shotPath != null) {
      draggingRef.current = true;
      onReorderStart(clipIdx, clip.id, d.x);
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = downAtRef.current;
    downAtRef.current = null;
    if (!d) return;
    if (draggingRef.current) {
      draggingRef.current = false;
      return;
    }
    // Treated as a click — open the picker (only if this clip is bound to a shot).
    if (clip.shotPath != null) {
      e.stopPropagation();
      setPickerOpen(true);
    }
  };

  return (
    <div
      ref={bodyRef}
      data-clip-idx={clipIdx}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className={`relative h-full overflow-hidden border-r border-border select-none ${
        isBlank ? "bg-inset" : "bg-surface"
      } ${clip.enabled ? "" : "opacity-40"} ${
        isPad ? "" : "cursor-pointer"
      }`}
      style={{ width: `${widthPct}%` }}
      title={resolved?.path ?? (isBlank ? "blank" : "no media")}
    >
      {resolved ? (
        resolved.isVideo ? (
          thumbBroken ? (
            <div className="absolute inset-0 flex items-center justify-center text-dim">
              <Icon name="movie" size={20} />
            </div>
          ) : (
            <img
              src={fileSrc(videoThumbCandidate(resolved.path))}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              onError={() => setThumbBroken(true)}
              draggable={false}
            />
          )
        ) : (
          <img
            src={fileSrc(resolved.path)}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            draggable={false}
          />
        )
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-dim text-xs">
          {isBlank ? "—" : "no media"}
        </div>
      )}

      {/* Disable toggle (not shown on the auto-pad). */}
      {!isPad && (
        <button
          type="button"
          title={clip.enabled ? "Disable clip" : "Enable clip"}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            toggleClipEnabled(clip.id);
          }}
          className="absolute top-[2px] left-[2px] w-[18px] h-[18px] inline-flex items-center justify-center bg-bg/70 hover:bg-bg text-text"
        >
          <Icon
            name={clip.enabled ? "visibility" : "visibility_off"}
            size={14}
            fill={!clip.enabled}
          />
        </button>
      )}

      <div className="absolute bottom-0 left-0 right-0 px-1 py-[1px] text-[10px] font-mono bg-bg/70 text-text whitespace-nowrap overflow-hidden flex items-center gap-1">
        <span className="truncate flex-1">
          {clip.shotPath ? basename(clip.shotPath) : "—"}
        </span>
        <span className="shrink-0 text-dim">{clip.durationSec.toFixed(1)}s</span>
      </div>

      {pickerOpen && clip.shotPath && (
        <ClipMediaPicker
          anchor={bodyRef.current}
          shotPath={clip.shotPath}
          currentMediaPath={clip.mediaPath}
          onPick={(path) => setClipMedia(clip.id, path)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
