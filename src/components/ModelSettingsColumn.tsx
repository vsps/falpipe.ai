import { ModelPicker } from "./ModelPicker";
import { SettingsPanel } from "./SettingsPanel";

export function ModelSettingsColumn() {
  return (
    <div className="bg-surface p-[10px] text-text w-[300px] flex flex-col gap-[10px] shrink-0">
      <div className="text-sm font-semibold">MODEL SETTINGS</div>
      <ModelPicker />
      <div className="flex-1 min-h-0 bg-inset rounded p-[8px]">
        <SettingsPanel />
      </div>
    </div>
  );
}
