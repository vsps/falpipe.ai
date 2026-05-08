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
                version: "SEQUENCE SRC".to_string(),
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
pub fn reveal_in_explorer(path: String) -> AppResult<()> {
    // Use explorer /select directly to avoid canonicalize() turning mapped
    // drive letters (Z:\...) into \\?\UNC\... paths that Explorer rejects.
    let native = path.replace('/', "\\");
    std::process::Command::new("explorer")
        .arg(format!("/select,{native}"))
        .spawn()
        .map_err(|e| AppError::Msg(e.to_string()))?;
    Ok(())
}

// ---------- Image triple (primary + .json sidecar + .thumb.png) helpers ----------

#[derive(Clone, Copy)]
enum CollisionPolicy {
    Overwrite,
    Error,
}

fn sibling_paths(p: &Path) -> AppResult<(String, String, PathBuf, PathBuf)> {
    let stem = p
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| AppError::Msg("no file stem".into()))?
        .to_string();
    let filename = p
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| AppError::Msg("no filename".into()))?
        .to_string();
    let dir = p
        .parent()
        .ok_or_else(|| AppError::Msg("no parent dir".into()))?;
    let sidecar = dir.join(format!("{stem}.json"));
    let thumb = dir.join(format!("{stem}.thumb.png"));
    Ok((stem, filename, sidecar, thumb))
}

fn same_dir(a: &Path, b: &Path) -> bool {
    let na = a.canonicalize().ok();
    let nb = b.canonicalize().ok();
    if let (Some(x), Some(y)) = (na, nb) {
        return x == y;
    }
    as_str(a) == as_str(b)
}

fn copy_triple_to_dir(src: &Path, dest_dir: &Path, policy: CollisionPolicy) -> AppResult<PathBuf> {
    if !src.is_file() {
        return Err(AppError::Msg(format!("not a file: {}", as_str(src))));
    }
    if !dest_dir.is_dir() {
        ensure_dir(dest_dir)?;
    }
    let src_dir = src
        .parent()
        .ok_or_else(|| AppError::Msg("no parent dir".into()))?;
    if same_dir(src_dir, dest_dir) {
        return Err(AppError::Msg(
            "source and destination are the same directory".into(),
        ));
    }
    let (_stem, filename, src_sidecar, src_thumb) = sibling_paths(src)?;
    let dest_primary = dest_dir.join(&filename);
    if dest_primary.exists() {
        if matches!(policy, CollisionPolicy::Error) {
            return Err(AppError::Msg(format!("FILENAME_EXISTS: {filename}")));
        }
    }
    std::fs::copy(src, &dest_primary)?;
    if src_sidecar.exists() {
        let dest_sidecar = dest_dir.join(src_sidecar.file_name().unwrap());
        if let Err(e) = std::fs::copy(&src_sidecar, &dest_sidecar) {
            eprintln!("sidecar copy failed: {e}");
        }
    }
    if src_thumb.exists() {
        let dest_thumb = dest_dir.join(src_thumb.file_name().unwrap());
        if let Err(e) = std::fs::copy(&src_thumb, &dest_thumb) {
            eprintln!("thumb copy failed: {e}");
        }
    }
    Ok(dest_primary)
}

fn move_one(src: &Path, dest: &Path) -> std::io::Result<()> {
    match std::fs::rename(src, dest) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::CrossesDevices => {
            std::fs::copy(src, dest)?;
            std::fs::remove_file(src)?;
            Ok(())
        }
        Err(e) => Err(e),
    }
}

fn move_triple_to_dir(src: &Path, dest_dir: &Path) -> AppResult<PathBuf> {
    if !src.is_file() {
        return Err(AppError::Msg(format!("not a file: {}", as_str(src))));
    }
    if !dest_dir.is_dir() {
        ensure_dir(dest_dir)?;
    }
    let src_dir = src
        .parent()
        .ok_or_else(|| AppError::Msg("no parent dir".into()))?;
    if same_dir(src_dir, dest_dir) {
        return Err(AppError::Msg(
            "source and destination are the same directory".into(),
        ));
    }
    let (_stem, filename, src_sidecar, src_thumb) = sibling_paths(src)?;
    let dest_primary = dest_dir.join(&filename);
    if dest_primary.exists() {
        return Err(AppError::Msg(format!("FILENAME_EXISTS: {filename}")));
    }
    move_one(src, &dest_primary)?;
    if src_sidecar.exists() {
        let dest_sidecar = dest_dir.join(src_sidecar.file_name().unwrap());
        if let Err(e) = move_one(&src_sidecar, &dest_sidecar) {
            eprintln!("sidecar move failed: {e}");
        }
    }
    if src_thumb.exists() {
        let dest_thumb = dest_dir.join(src_thumb.file_name().unwrap());
        if let Err(e) = move_one(&src_thumb, &dest_thumb) {
            eprintln!("thumb move failed: {e}");
        }
    }
    Ok(dest_primary)
}

fn validate_filename_stem(stem: &str) -> AppResult<()> {
    if stem.is_empty() {
        return Err(AppError::Msg("name is empty".into()));
    }
    for c in stem.chars() {
        if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() {
            return Err(AppError::Msg(format!("invalid character: {c:?}")));
        }
    }
    let upper = stem.to_ascii_uppercase();
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
        "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if reserved.contains(&upper.as_str()) {
        return Err(AppError::Msg(format!("reserved name: {stem}")));
    }
    Ok(())
}

#[tauri::command]
pub fn ref_copy_to_src(shot_path: String, source_path: String) -> AppResult<String> {
    let src = PathBuf::from(&source_path);
    let dir = shot_src_dir(&PathBuf::from(&shot_path))?;
    let dest = copy_triple_to_dir(&src, &dir, CollisionPolicy::Overwrite)?;
    Ok(as_str(&dest))
}

#[tauri::command]
pub fn ref_copy_to_seq_src(shot_path: String, source_path: String) -> AppResult<String> {
    let src = PathBuf::from(&source_path);
    let seq_dir = PathBuf::from(&shot_path)
        .parent()
        .ok_or_else(|| AppError::Msg("no sequence parent".into()))?
        .join(SRC_DIR);
    ensure_dir(&seq_dir)?;
    let dest = copy_triple_to_dir(&src, &seq_dir, CollisionPolicy::Overwrite)?;
    Ok(as_str(&dest))
}

#[tauri::command]
pub fn image_copy_to_dir(source_path: String, dest_dir: String) -> AppResult<String> {
    let src = PathBuf::from(&source_path);
    let dest = PathBuf::from(&dest_dir);
    let out = copy_triple_to_dir(&src, &dest, CollisionPolicy::Error)?;
    Ok(as_str(&out))
}

#[tauri::command]
pub fn image_move_to_dir(source_path: String, dest_dir: String) -> AppResult<String> {
    let src = PathBuf::from(&source_path);
    let dest = PathBuf::from(&dest_dir);
    let out = move_triple_to_dir(&src, &dest)?;
    Ok(as_str(&out))
}

#[tauri::command]
pub fn image_rename(source_path: String, new_stem: String) -> AppResult<String> {
    let src = PathBuf::from(&source_path);
    if !src.is_file() {
        return Err(AppError::Msg(format!("not a file: {source_path}")));
    }
    let trimmed = new_stem.trim();
    validate_filename_stem(trimmed)?;
    let (old_stem, _filename, old_sidecar, old_thumb) = sibling_paths(&src)?;
    if trimmed == old_stem {
        return Err(AppError::Msg("name unchanged".into()));
    }
    let dir = src
        .parent()
        .ok_or_else(|| AppError::Msg("no parent dir".into()))?;
    let ext = src
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_string());
    let new_filename = match &ext {
        Some(e) if !e.is_empty() => format!("{trimmed}.{e}"),
        _ => trimmed.to_string(),
    };
    let new_primary = dir.join(&new_filename);
    let new_sidecar = dir.join(format!("{trimmed}.json"));
    let new_thumb = dir.join(format!("{trimmed}.thumb.png"));
    if new_primary.exists() {
        return Err(AppError::Msg(format!("FILENAME_EXISTS: {new_filename}")));
    }
    if old_sidecar.exists() && new_sidecar.exists() {
        return Err(AppError::Msg(format!(
            "FILENAME_EXISTS: {trimmed}.json"
        )));
    }
    if old_thumb.exists() && new_thumb.exists() {
        return Err(AppError::Msg(format!(
            "FILENAME_EXISTS: {trimmed}.thumb.png"
        )));
    }
    std::fs::rename(&src, &new_primary)?;
    if old_sidecar.exists() {
        if let Err(e) = std::fs::rename(&old_sidecar, &new_sidecar) {
            eprintln!("sidecar rename failed: {e}");
        }
    }
    if old_thumb.exists() {
        if let Err(e) = std::fs::rename(&old_thumb, &new_thumb) {
            eprintln!("thumb rename failed: {e}");
        }
    }
    Ok(as_str(&new_primary))
}

#[tauri::command]
pub fn save_png_base64(path: String, data_base64: String) -> AppResult<()> {
    use base64::{Engine, engine::general_purpose::STANDARD};
    let bytes = STANDARD
        .decode(&data_base64)
        .map_err(|e| AppError::Msg(format!("base64 decode: {e}")))?;
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        ensure_dir(parent)?;
    }
    std::fs::write(&p, &bytes)?;
    Ok(())
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
            prompts: None,
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
            prompts: None,
        });
        write_sidecar_atomic(&path, &sidecar)?;
    }
    Ok(sidecar)
}

#[tauri::command]
pub fn shot_prompts_append(shot_path: String, prompts: Vec<String>) -> AppResult<ShotSidecar> {
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
    let combined = prompts.join("\n\n");
    if sidecar.prompt_history.last().map(|e| e.prompt.as_str()) != Some(combined.as_str()) {
        sidecar.prompt_history.push(PromptEntry {
            timestamp: Utc::now().to_rfc3339(),
            prompt: combined,
            prompts: Some(prompts),
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
