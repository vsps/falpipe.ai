import { ModelSettingsColumn } from "./ModelSettingsColumn";
import { PromptColumn } from "./PromptColumn";
import { RefImagesColumn } from "./RefImagesColumn";
import { LatestImageColumn } from "./LatestImageColumn";
import { RunColumn } from "./RunColumn";

export function Workbench() {
  return (
    <div className="flex flex-1 min-h-0 gap-prompt-surface bg-panel overflow-hidden">
      <ModelSettingsColumn />
      <PromptColumn scope="sequence" title="SEQUENCE PROMPT" />
      <PromptColumn scope="shot" title="SHOT PROMPT" />
      <RefImagesColumn />
      <LatestImageColumn />
      <RunColumn />
    </div>
  );
}
