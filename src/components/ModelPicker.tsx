import { useMemo, useState } from "react";
import { useModelsStore } from "../stores/modelsStore";
import { useGenerationStore } from "../stores/generationStore";

type Filter = "all" | "fal" | "replicate";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "all" },
  { id: "fal", label: "fal" },
  { id: "replicate", label: "replicate" },
];

export function ModelPicker() {
  const { entries, loaded } = useModelsStore();
  const { currentModel, selectModel } = useGenerationStore();
  const [filter, setFilter] = useState<Filter>("all");

  const visible = useMemo(
    () =>
      entries.filter((e) =>
        filter === "all" ? true : (e.node.provider ?? "fal") === filter,
      ),
    [entries, filter],
  );

  const images = visible.filter((e) => e.node.kind === "image");
  const videos = visible.filter((e) => e.node.kind === "video");

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1 text-xs font-mono">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={
              filter === f.id
                ? "px-2 py-[1px] bg-accent text-bg"
                : "px-2 py-[1px] bg-bg text-text hover:opacity-80"
            }
          >
            {f.label}
          </button>
        ))}
      </div>
      <select
        className="bg-bg text-text px-1 py-[2px] w-full"
        value={currentModel?.id ?? ""}
        onChange={(e) => {
          const id = e.currentTarget.value;
          const node = entries.find((x) => x.node.id === id)?.node ?? null;
          selectModel(node);
        }}
      >
        <option value="">{loaded ? "— choose model —" : "Loading…"}</option>
        {images.length > 0 && (
          <optgroup label="Image">
            {images.map((e) => (
              <option key={e.node.id} value={e.node.id}>
                {e.node.provider ?? "fal"} · {e.node.name}
              </option>
            ))}
          </optgroup>
        )}
        {videos.length > 0 && (
          <optgroup label="Video">
            {videos.map((e) => (
              <option key={e.node.id} value={e.node.id}>
                {e.node.provider ?? "fal"} · {e.node.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}
