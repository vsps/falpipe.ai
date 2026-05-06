import { open, save, message, confirm } from "@tauri-apps/plugin-dialog";
import { playSound } from "./audio";

export async function pickDirectory(title: string, defaultPath?: string): Promise<string | null> {
  const res = await open({ directory: true, multiple: false, title, defaultPath });
  return typeof res === "string" ? res : null;
}

export async function pickFile(
  title: string,
  opts?: { extensions?: string[]; multiple?: boolean; defaultPath?: string },
): Promise<string[] | null> {
  const filters = opts?.extensions?.length
    ? [{ name: "files", extensions: opts.extensions }]
    : undefined;
  const res = await open({
    directory: false,
    multiple: !!opts?.multiple,
    title,
    filters,
    defaultPath: opts?.defaultPath,
  });
  if (res == null) return null;
  return Array.isArray(res) ? res : [res];
}

export async function pickSaveFile(
  title: string,
  opts?: { extensions?: string[]; defaultPath?: string },
): Promise<string | null> {
  const filters = opts?.extensions?.length
    ? [{ name: "files", extensions: opts.extensions }]
    : undefined;
  const res = await save({ title, filters, defaultPath: opts?.defaultPath });
  return res;
}

export async function showMessage(text: string, opts?: { title?: string; kind?: "info" | "warning" | "error" }) {
  if (opts?.kind === "error") playSound("buzz");
  await message(text, { title: opts?.title, kind: opts?.kind });
}

export async function confirmAction(
  text: string,
  opts?: { title?: string; kind?: "info" | "warning" | "error" },
): Promise<boolean> {
  return await confirm(text, { title: opts?.title, kind: opts?.kind });
}
