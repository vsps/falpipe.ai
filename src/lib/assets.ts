import { convertFileSrc } from "@tauri-apps/api/core";

/** Convert an absolute disk path to a URL loadable inside the WebView. */
export function fileSrc(path: string): string {
  return convertFileSrc(path);
}
