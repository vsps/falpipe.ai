import { useEffect, useRef } from "react";
import { useLogStore } from "../stores/logStore";

const LEVEL_CLASS: Record<string, string> = {
  INFO: "text-dim",
  PROGRESS: "text-text",
  SUCCESS: "text-ok",
  ERROR: "text-bad",
};

export function LogWindow() {
  const lines = useLogStore((s) => s.lines);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines.length]);

  // Show the last 5 lines only (rolling window per spec).
  const visible = lines.slice(-5);

  return (
    <div
      ref={ref}
      className="bg-panel text-dim px-2 py-1 font-mono overflow-hidden flex flex-col"
      style={{ fontSize: 11, height: 5 * 14 + 8 }}
    >
      {visible.length === 0 ? (
        <span className="opacity-40">—</span>
      ) : (
        visible.map((l) => (
          <div
            key={l.id}
            className={`truncate ${LEVEL_CLASS[l.level] ?? "text-text"}`}
            title={`${l.timestamp} ${l.level} ${l.message}`}
          >
            <span className="opacity-60">{formatTime(l.timestamp)}</span> {l.message}
          </div>
        ))
      )}
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
