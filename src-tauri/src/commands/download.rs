use std::path::PathBuf;

use crate::error::{AppError, AppResult};

#[tauri::command]
pub async fn download_to_path(url: String, target: String) -> AppResult<()> {
    let resp = reqwest::get(&url)
        .await
        .map_err(|e| AppError::Msg(format!("fetch: {e}")))?;
    if !resp.status().is_success() {
        return Err(AppError::Msg(format!("HTTP {} downloading {url}", resp.status())));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| AppError::Msg(format!("read body: {e}")))?;
    let target = PathBuf::from(&target);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = target.with_extension("part");
    std::fs::write(&tmp, &bytes)?;
    std::fs::rename(&tmp, &target)?;
    Ok(())
}
