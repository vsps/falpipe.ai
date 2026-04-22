export function basename(p: string | null | undefined): string {
  if (!p) return "";
  const s = p.replaceAll("\\", "/").replace(/\/+$/, "");
  const i = s.lastIndexOf("/");
  return i < 0 ? s : s.slice(i + 1);
}

export function dirname(p: string | null | undefined): string {
  if (!p) return "";
  const s = p.replaceAll("\\", "/").replace(/\/+$/, "");
  const i = s.lastIndexOf("/");
  return i < 0 ? "" : s.slice(0, i);
}

export function joinPath(...parts: (string | null | undefined)[]): string {
  return parts
    .filter((p): p is string => !!p)
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, "") : p.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "")))
    .join("/");
}

export function isChildOf(parent: string, child: string): boolean {
  const norm = (p: string) => p.replaceAll("\\", "/").replace(/\/+$/, "");
  const p = norm(parent);
  const c = norm(child);
  return c === p || c.startsWith(p + "/");
}
