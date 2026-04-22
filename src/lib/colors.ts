import type { ColorOverrides } from "./types";

export const DEFAULT_COLORS: Required<ColorOverrides> = {
  bg: "#ffffff",
  panel: "#cccccc",
  surface: "#bbbbbb",
  text: "#111111",
  accent: "#e94560",
};

export const COLOR_KEYS: (keyof ColorOverrides)[] = [
  "bg",
  "panel",
  "surface",
  "text",
  "accent",
];

/** Push the given overrides into :root as CSS custom properties so Tailwind utilities
 *  (bg-bg, bg-panel, …) resolve to the overridden values. */
export function applyColors(overrides: ColorOverrides | null | undefined): void {
  const root = document.documentElement;
  for (const key of COLOR_KEYS) {
    const value = overrides?.[key];
    if (value) {
      root.style.setProperty(`--color-${key}`, value);
    } else {
      root.style.removeProperty(`--color-${key}`);
    }
  }
}
