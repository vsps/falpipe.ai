use std::path::PathBuf;
use std::process::Command;

use crate::error::AppResult;

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
