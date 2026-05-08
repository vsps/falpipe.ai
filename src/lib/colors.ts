import type { ColorOverrides } from "./types";

export const DEFAULT_COLORS: Required<ColorOverrides> = {
  bg: "#303030",
  border: "#202020",
  src: "#353535",
  handle: "#505050",
  text: "#aaaaaa",
  accent: "#9b31f2",
};

export const COLOR_KEYS: (keyof ColorOverrides)[] = [
  "bg",
  "src",
  "text",
  "accent",
  "handle",
  "border",
];

/** Push overrides into :root CSS custom properties. Always sets explicit values — never
 *  removes properties — so Tailwind utilities always resolve to the expected color. */
export function applyColors(overrides: ColorOverrides | null | undefined): void {
  const root = document.documentElement;
  for (const key of COLOR_KEYS) {
    const value = (overrides?.[key]) ?? DEFAULT_COLORS[key];
    const cssVar =
      key === "src" ? "--color-src-bg"
      : key === "border" ? "--color-border"
      : key === "handle" ? "--color-handle"
      : `--color-${key}`;
    root.style.setProperty(cssVar, value);
    if (key === "bg") {
      root.style.setProperty("--color-panel", value);
      root.style.setProperty("--color-surface", value);
      root.style.setProperty("--color-gallery-surface", value);
    }
    if (key === "src") {
      root.style.setProperty("--color-inset", value);
    }
  }
}
