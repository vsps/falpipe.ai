import { useEffect, useMemo, useRef, useState } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { useTimelineStore, resolveClipMedia, clipAtPlayhead } from "../stores/timelineStore";
import { fileSrc } from "../lib/assets";
import { PathContextMenu } from "./PathContextMenu";
import { performImageAction } from "../lib/actions";
import type { GalleryImage, GalleryColumn } from "../lib/types";

/**
 * Fills remaining horizontal space between RefImages and Run. Shows the
 * current selection, or the last image in the target version (i.e. the most
 * recent generation). Videos render with native controls.
 *
 * When the timeline is playing (or scrubbed past 0), this column instead
 * becomes the timeline preview surface.
 */
export function LatestImageColumn() {
  const columns = useSessionStore((s) => s.columns);
  const selectedImagePath = useSessionStore((s) => s.selectedImagePath);
  const targetVersion = useSessionStore((s) => s.targetVersion);
  const tlClips = useTimelineStore((s) => s.clips);
  const tlTotal = useTimelineStore((s) => s.totalDurationSec);
  const tlPlaying = useTimelineStore((s) => s.playing);
  const tlPlayhead = useTimelineStore((s) => s.playheadSec);
  const tlShotsLatestMedia = useTimelineStore((s) => s.shotsLatestMedia);

  const timelineActive = tlPlaying || tlPlayhead > 0;

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
        <span>{timelineActive ? "TIMELINE" : "LATEST"}</span>
        {!timelineActive && image && (
          <>
            <span className="flex-1" />
            <span className="text-xs opacity-60 font-mono truncate" title={image.path}>
              {image.filename}
            </span>
          </>
        )}
      </div>
      <div className="flex-1 min-h-0 bg-inset flex items-center justify-center overflow-hidden">
        {timelineActive ? (
          <TimelinePreview
            clips={tlClips}
            totalDurationSec={tlTotal}
            playheadSec={tlPlayhead}
            playing={tlPlaying}
            shotsLatestMedia={tlShotsLatestMedia}
          />
        ) : image ? (
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
              className="max-w-full max-h-full object-contain cursor-zoom-in"
              onClick={() => void performImageAction("zoom", image.path)}
              onContextMenu={onCtx}
            />
          )
        ) : (
          <div className="text-xs text-dim">No image</div>
        )}
      </div>
      {menuPos && image && !timelineActive && (
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

function TimelinePreview({
  clips,
  totalDurationSec,
  playheadSec,
  playing,
  shotsLatestMedia,
}: {
  clips: import("../lib/types").TimelineClip[];
  totalDurationSec: number;
  playheadSec: number;
  playing: boolean;
  shotsLatestMedia: Map<string, import("../lib/types").ShotLatestMedia>;
}) {
  const ctx = clipAtPlayhead(clips, totalDurationSec, playheadSec);
  if (!ctx) return <div className="w-full h-full bg-black" />;

  const { clip, startSec, isPad } = ctx;
  const resolved = resolveClipMedia(clip, shotsLatestMedia);

  // Disabled / blank / unresolved → black panel for the slot duration.
  if (!clip.enabled || isPad || !resolved) {
    return <div className="w-full h-full bg-black" />;
  }

  if (resolved.isVideo) {
    return (
      <VideoSlot
        key={`${clip.id}|${resolved.path}`}
        path={resolved.path}
        clipStartSec={startSec}
        playheadSec={playheadSec}
        playing={playing}
      />
    );
  }

  return (
    <img
      key={`${clip.id}|${resolved.path}`}
      src={fileSrc(resolved.path)}
      alt=""
      className="max-w-full max-h-full object-contain"
      draggable={false}
    />
  );
}

function VideoSlot({
  path,
  clipStartSec,
  playheadSec,
  playing,
}: {
  path: string;
  clipStartSec: number;
  playheadSec: number;
  playing: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  // Drive play / pause from the timeline.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (playing) {
      void v.play().catch(() => {
        /* play() can reject if metadata isn't ready yet — next render will retry */
      });
    } else {
      v.pause();
    }
  }, [playing]);

  // Drift-correct currentTime when the playhead diverges from the video.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const target = playheadSec - clipStartSec;
    if (!Number.isFinite(target) || target < 0) return;
    if (Math.abs(v.currentTime - target) > 0.15) {
      try {
        v.currentTime = target;
      } catch {
        /* ignored — video not ready */
      }
    }
  }, [clipStartSec, playheadSec]);

  return (
    <video
      ref={ref}
      src={fileSrc(path)}
      className="max-w-full max-h-full"
      muted={false}
      playsInline
      preload="auto"
    />
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
