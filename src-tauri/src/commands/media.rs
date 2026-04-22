use std::path::PathBuf;
use std::process::Command;

use image::imageops::colorops::huerotate;

use crate::error::{AppError, AppResult};

/// Copy `src_path` to `dest_path` with its hue rotated by `hue_deg` degrees.
/// Used by test mode to generate visually-distinct outputs without calling fal.ai.
#[tauri::command]
pub fn test_mode_hue_shift(src_path: String, dest_path: String, hue_deg: i32) -> AppResult<()> {
    let img = image::open(&src_path)
        .map_err(|e| AppError::Msg(format!("open {src_path}: {e}")))?;
    let rgba = img.to_rgba8();
    let shifted = huerotate(&rgba, hue_deg);
    let dest = PathBuf::from(&dest_path);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    shifted
        .save(&dest)
        .map_err(|e| AppError::Msg(format!("save {dest_path}: {e}")))?;
    Ok(())
}

/// Extract a frame from `video_path` into `thumb_path` using the provided ffmpeg binary.
/// Returns `false` (not an error) when ffmpeg is missing or extraction fails — caller decides.
#[tauri::command]
pub fn video_thumbnail_extract(
    video_path: String,
    thumb_path: String,
    ffmpeg_path: String,
) -> AppResult<bool> {
    let exe = ffmpeg_path.trim();
    if exe.is_empty() {
        return Ok(false);
    }
    let exe_path = PathBuf::from(exe);
    if !exe_path.is_file() {
        return Ok(false);
    }
    let thumb = PathBuf::from(&thumb_path);
    if let Some(parent) = thumb.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // Grab ~1s frame; `-ss 00:00:01` after -i for accuracy.
    let status = Command::new(&exe_path)
        .args([
            "-y",
            "-i",
            &video_path,
            "-ss",
            "00:00:01",
            "-vframes",
            "1",
            &thumb_path,
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
    match status {
        Ok(s) if s.success() => Ok(thumb.exists()),
        _ => Ok(false),
    }
}
