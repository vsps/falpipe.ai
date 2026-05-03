use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::Serialize;

use crate::domain::{
    GalleryColumn, GalleryImage, ProjectSidecar, PromptEntry, SequenceSidecar, ShotSidecar,
};
use crate::error::{AppError, AppResult};

const PROJECT_SIDECAR: &str = "project.json";
const SEQUENCE_SIDECAR: &str = "sequence.json";
const SHOT_SIDECAR: &str = "shot.json";
const SRC_DIR: &str = "SRC";

const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp"];
const VIDEO_EXTS: &[&str] = &["mp4", "webm"];

// ---------- Helpers ----------

fn as_str(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

fn is_version_name(name: &str) -> bool {
    name.len() == 4 && name.starts_with('v') && name[1..].chars().all(|c| c.is_ascii_digit())
}

fn read_sidecar<T: serde::de::DeserializeOwned + Default>(path: &Path) -> AppResult<T> {
    if !path.exists() {
        return Ok(T::default());
    }
    let text = std::fs::read_to_string(path)?;
    match serde_json::from_str::<T>(&text) {
        Ok(v) => Ok(v),
        Err(_) => Ok(T::default()),
    }
}

fn write_sidecar_atomic<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(value)?;
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

fn ensure_dir(path: &Path) -> AppResult<()> {
    std::fs::create_dir_all(path)?;
    Ok(())
}

/// Always resolves to `<shot>/SRC`. Sequence-level SRC is handled separately
/// via `ref_copy_to_seq_src`.
fn shot_src_dir(shot_path: &Path) -> AppResult<PathBuf> {
    let dir = shot_path.join(SRC_DIR);
    ensure_dir(&dir)?;
    Ok(dir)
}

fn list_dirs(root: &Path) -> AppResult<Vec<PathBuf>> {
    if !root.is_dir() {
        return Ok(vec![]);
    }
    let mut out: Vec<_> = std::fs::read_dir(root)?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .filter(|p| {
            // Skip hidden + system dirs.
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| !n.starts_with('.') && !n.starts_with('$'))
                .unwrap_or(false)
        })
        .collect();
    out.sort();
    Ok(out)
}

// ---------- Commands ----------

#[tauri::command]
pub fn project_open(project_path: String) -> AppResult<Vec<String>> {
    let root = PathBuf::from(&project_path);
    if !root.is_dir() {
        return Err(AppError::Msg(format!("not a directory: {project_path}")));
    }
    // Reject folders that are clearly sequences or shots, not projects.
    if root.join(SEQUENCE_SIDECAR).exists() || root.join(SHOT_SIDECAR).exists() {
        return Err(AppError::Msg("NOT A PROJECT FOLDER".into()));
    }
    // Auto-create project.json on first open (new project or migration).
    let sidecar_path = root.join(PROJECT_SIDECAR);
    if !sidecar_path.exists() {
        let title = root
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("project")
            .to_string();
        write_sidecar_atomic(
            &sidecar_path,
            &ProjectSidecar {
                title,
                created: Utc::now().to_rfc3339(),
            },
        )?;
    }
    let dirs = list_dirs(&root)?;
    Ok(dirs.iter().map(|p| as_str(p)).collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceOpenResult {
    pub shots: Vec<String>,
    pub sidecar: SequenceSidecar,
}

#[tauri::command]
pub fn sequence_open(sequence_path: String) -> AppResult<SequenceOpenResult> {
    let root = PathBuf::from(&sequence_path);
    if !root.is_dir() {
        return Err(AppError::Msg(format!("not a directory: {sequence_path}")));
    }
    // Always ensure a sequence-level SRC exists. Empty when toggle is "shot" —
    // harmless, and means flipping to "sequence" later self-heals.
    ensure_dir(&root.join(SRC_DIR))?;
    let sidecar: SequenceSidecar = read_sidecar(&root.join(SEQUENCE_SIDECAR))?;
    let dirs = list_dirs(&root)?;
    let shots = dirs
        .into_iter()
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n != SRC_DIR)
                .unwrap_or(false)
        })
        .map(|p| as_str(&p))
        .collect();
    Ok(SequenceOpenResult { shots, sidecar })
}

#[tauri::command]
pub fn sequence_create(project_path: String, name: String) -> AppResult<String> {
    let target = PathBuf::from(&project_path).join(sanitize(&name));
    ensure_dir(&target)?;
    ensure_dir(&target.join(SRC_DIR))?;
    let sidecar_path = target.join(SEQUENCE_SIDECAR);
    if !sidecar_path.exists() {
        write_sidecar_atomic(
            &sidecar_path,
            &SequenceSidecar {
                name: name.clone(),
                prompt_history: vec![],
            },
        )?;
    }
    Ok(as_str(&target))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShotOpenResult {
    pub columns: Vec<GalleryColumn>,
    pub sidecar: ShotSidecar,
}

#[tauri::command]
pub fn shot_open(shot_path: String) -> AppResult<ShotOpenResult> {
    let root = PathBuf::from(&shot_path);
    if !root.is_dir() {
        return Err(AppError::Msg(format!("not a directory: {shot_path}")));
    }
    shot_src_dir(&root)?;
    let sidecar: ShotSidecar = read_sidecar(&root.join(SHOT_SIDECAR))?;
    let columns = scan_shot_columns(&root)?;
    Ok(ShotOpenResult { columns, sidecar })
}

#[tauri::command]
pub fn shot_rescan(shot_path: String) -> AppResult<Vec<GalleryColumn>> {
    let root = PathBuf::from(&shot_path);
    scan_shot_columns(&root)
}

#[tauri::command]
pub fn shot_create(sequence_path: String, name: String) -> AppResult<String> {
    let target = PathBuf::from(&sequence_path).join(sanitize(&name));
    ensure_dir(&target)?;
    shot_src_dir(&target)?;
    let sidecar_path = target.join(SHOT_SIDECAR);
    if !sidecar_path.exists() {
        write_sidecar_atomic(
            &sidecar_path,
            &ShotSidecar {
                name,
                prompt_history: vec![],
            },
        )?;
    }
    Ok(as_str(&target))
}

fn scan_shot_columns(root: &Path) -> AppResult<Vec<GalleryColumn>> {
    let mut cols: Vec<GalleryColumn> = Vec::new();

    // Always include the shot's own SRC as "SHOT SRC".
    let shot_src = root.join(SRC_DIR);
    if shot_src.is_dir() {
        let images = scan_directory_images(&shot_src)?;
        cols.push(GalleryColumn {
            id: as_str(&shot_src),
            version: "SHOT SRC".to_string(),
            is_src: true,
            images,
            timestamp: None,
            model_name: None,
        });
    }

    // Always include the sequence-level SRC as "SEQ SRC".
    if let Some(seq) = root.parent() {
        let seq_src = seq.join(SRC_DIR);
        if seq_src.is_dir() {
            let images = scan_directory_images(&seq_src)?;
            cols.push(GalleryColumn {
                id: as_str(&seq_src),
                version: "SEQ SRC".to_string(),
                is_src: true,
                images,
                timestamp: None,
                model_name: None,
            });
        }
    }

    // Scan version directories.
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let name = match p.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if name == SRC_DIR {
            continue;
        }
        if name.starts_with('.') || name.starts_with('$') {
            continue;
        }
        let images = scan_directory_images(&p)?;
        cols.push(GalleryColumn {
            id: name.clone(),
            version: name,
            is_src: false,
            images,
            timestamp: None,
            model_name: None,
        });
    }

    cols.sort_by(|a, b| match (a.is_src, b.is_src) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.version.cmp(&b.version),
    });
    Ok(cols)
}

fn scan_directory_images(dir: &Path) -> AppResult<Vec<GalleryImage>> {
    let mut out: Vec<GalleryImage> = Vec::new();
    for e in std::fs::read_dir(dir)? {
        let entry = e?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let filename = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        // Skip `.thumb.png` — it's an adjunct of a video.
        if filename.ends_with(".thumb.png") {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();
        let is_image = IMAGE_EXTS.iter().any(|e| *e == ext);
        let is_video = VIDEO_EXTS.iter().any(|e| *e == ext);
        if !is_image && !is_video {
            continue;
        }
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        let meta_path = path.with_file_name(format!("{stem}.json"));
        let thumb_path = if is_video {
            let t = path.with_file_name(format!("{stem}.thumb.png"));
            if t.exists() {
                Some(as_str(&t))
            } else {
                None
            }
        } else {
            None
        };
        out.push(GalleryImage {
            filename,
            path: as_str(&path),
            metadata_path: as_str(&meta_path),
            is_video,
            thumb_path,
        });
    }
    out.sort_by(|a, b| a.filename.cmp(&b.filename));
    Ok(out)
}

#[tauri::command]
pub fn version_create_next(shot_path: String) -> AppResult<String> {
    let root = PathBuf::from(&shot_path);
    let mut max_n = 0u32;
    if let Ok(it) = std::fs::read_dir(&root) {
        for e in it.flatten() {
            if let Some(name) = e.file_name().to_str() {
                if is_version_name(name) {
                    if let Ok(n) = name[1..].parse::<u32>() {
                        if n > max_n {
                            max_n = n;
                        }
                    }
                }
            }
        }
    }
    let next = format!("v{:03}", max_n + 1);
    ensure_dir(&root.join(&next))?;
    Ok(next)
}

#[tauri::command]
pub fn reveal_in_explorer(app: tauri::AppHandle, path: String) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|e| AppError::Msg(e.to_string()))
}

#[tauri::command]
pub fn ref_copy_to_src(shot_path: String, source_path: String) -> AppResult<String> {
    let src = PathBuf::from(&source_path);
    if !src.is_file() {
        return Err(AppError::Msg(format!("not a file: {source_path}")));
    }
    let dir = shot_src_dir(&PathBuf::from(&shot_path))?;
    let filename = src
        .file_name()
        .ok_or_else(|| AppError::Msg("no filename".into()))?;
    let dest = dir.join(filename);
    std::fs::copy(&src, &dest)?;
    Ok(as_str(&dest))
}

#[tauri::command]
pub fn ref_copy_to_seq_src(shot_path: String, source_path: String) -> AppResult<String> {
    let src = PathBuf::from(&source_path);
    if !src.is_file() {
        return Err(AppError::Msg(format!("not a file: {source_path}")));
    }
    let seq_dir = PathBuf::from(&shot_path)
        .parent()
        .ok_or_else(|| AppError::Msg("no sequence parent".into()))?
        .join(SRC_DIR);
    ensure_dir(&seq_dir)?;
    let filename = src
        .file_name()
        .ok_or_else(|| AppError::Msg("no filename".into()))?;
    let dest = seq_dir.join(filename);
    std::fs::copy(&src, &dest)?;
    Ok(as_str(&dest))
}

#[tauri::command]
pub fn sequence_prompt_append(sequence_path: String, prompt: String) -> AppResult<SequenceSidecar> {
    let root = PathBuf::from(&sequence_path);
    let path = root.join(SEQUENCE_SIDECAR);
    let mut sidecar: SequenceSidecar = read_sidecar(&path)?;
    if sidecar.name.is_empty() {
        sidecar.name = root
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
    }
    if sidecar.prompt_history.last().map(|e| e.prompt.as_str()) != Some(prompt.as_str()) {
        sidecar.prompt_history.push(PromptEntry {
            timestamp: Utc::now().to_rfc3339(),
            prompt,
        });
        write_sidecar_atomic(&path, &sidecar)?;
    }
    Ok(sidecar)
}

#[tauri::command]
pub fn shot_prompt_append(shot_path: String, prompt: String) -> AppResult<ShotSidecar> {
    let root = PathBuf::from(&shot_path);
    let path = root.join(SHOT_SIDECAR);
    let mut sidecar: ShotSidecar = read_sidecar(&path)?;
    if sidecar.name.is_empty() {
        sidecar.name = root
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
    }
    if sidecar.prompt_history.last().map(|e| e.prompt.as_str()) != Some(prompt.as_str()) {
        sidecar.prompt_history.push(PromptEntry {
            timestamp: Utc::now().to_rfc3339(),
            prompt,
        });
        write_sidecar_atomic(&path, &sidecar)?;
    }
    Ok(sidecar)
}

fn sanitize(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect()
}
