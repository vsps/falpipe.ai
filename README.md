<pre><code>


░█▀▀░█▀█░█░░░█▀█░▀█▀░█▀█░█▀▀
░█▀▀░█▀█░█░░░█▀▀░░█░░█▀▀░█▀▀
░▀░░░▀░▀░▀▀▀░▀░░░▀▀▀░▀░░░▀▀▀

</code></pre>

# falPipe

A desktop GUI for [fal.ai](https://fal.ai) built around a **project / sequence / shot** file layout — meant for iterating on generative image & video shots as part of a larger production pipeline at speed while saving all media to disk.

This tool was designed as an antidote to overcomplicated node graphs which in many cases end up quite linear regardless. Complexity is not a flex.

Built with React + Tailwind (frontend) on a Rust + Tauri (native) host. Windows is the primary target; macOS and Linux should build from source.

ENTIRELY VIBE CODED SO GOOD LUCK EVERYBODY!

![falPipe](https://github.com/user-attachments/assets/8750222f-635d-4d88-b7d3-e0cfbaf3383d)


## Features

- **Model library driven by JSON** — drop a file in `models/` and the app picks it up. Ships with FLUX, Nano Banana 2 / Pro, Veo3, Kling 3 (image + video), and Topaz Upscale.
- **Project → sequence → shot layout** — results and reference images are organized on disk so you can version shots and track iterations.
- **Prompt history** — per-sequence and per-shot prompts are saved as sidecars and navigable with ←/→ arrows.
- **Reference images with roles** — start frame, end frame, source, or `@ElementN` groups (with a "frontal" flag) that map onto Kling 3's nested element payload. Drag to reorder; drop OS files into the REF_IMAGES panel to add.
- **Gallery** — every generation writes alongside its metadata; each shot has a SRC column (inputs) plus `v001/`, `v002/`, … version columns (outputs).

## Install

Prereqs:

- [Rust](https://rustup.rs/) (stable)
- [pnpm](https://pnpm.io/) 8+ and Node 20+
- Windows: Microsoft C++ Build Tools + WebView2 (bundled with Windows 11)
- A [fal.ai API key](https://fal.ai/dashboard/keys)

```bash
git clone https://github.com/vsps/falpipe.git
cd falpipe
pnpm install
pnpm tauri dev       # run
pnpm tauri build     # produce an installer in src-tauri/target/release/bundle
```

## Configure

On first launch the app creates `%APPDATA%\falPipe\` (Windows) or the equivalent config dir on other OSes with:

- `.env` — holds `FAL_KEY=...`. Set it via the **Settings** dialog (gear icon, top-right) or drop it in manually.
- `config.json` — project path, last-used sequence/shot/model, ffmpeg path.
- `app-state.json` — prompts, settings, reference-image roles (restored on launch).

**ffmpeg** is required for video thumbnail extraction. Point to it in Settings if it isn't on `PATH`.

## Basic usage

1. Pick a **project directory** (top bar). This is any folder — falPipe creates `sequence/shot/{SRC,v001,…}` subdirectories as you go.
2. Create or pick a **sequence**, then a **shot**.
3. Choose a **model** from the left column. Its parameters appear below.
4. Type a **SEQUENCE** and/or **SHOT** prompt. The sequence prompt is prepended to every shot in that sequence.
5. (Optional) Add **reference images** — click the add button or drag files from your OS onto the panel. Click a thumbnail's top bar to assign a role:
   - `start` / `end` — exclusive slots for img2vid / first-last-frame models.
   - `@ElementN` — Kling-style named references. First image in a group is the frontal by default (★); toggle the checkbox to promote another.
6. Click **Generate**. The result lands in a new `vNNN/` column in the gallery and is saved with a sidecar containing the prompt, settings, and reference URLs used.

## License

AGPL v3.0
