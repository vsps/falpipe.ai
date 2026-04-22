import { useModelsStore } from "../stores/modelsStore";
import { useGenerationStore } from "../stores/generationStore";

export function ModelPicker() {
  const { entries, loaded } = useModelsStore();
  const { currentModel, selectModel } = useGenerationStore();

  const images = entries.filter((e) => e.node.kind === "image");
  const videos = entries.filter((e) => e.node.kind === "video");

  return (
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
              {e.family} · {e.node.name}
            </option>
          ))}
        </optgroup>
      )}
      {videos.length > 0 && (
        <optgroup label="Video">
          {videos.map((e) => (
            <option key={e.node.id} value={e.node.id}>
              {e.family} · {e.node.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
