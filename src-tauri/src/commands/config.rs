use crate::domain::{AppState, Config};
use crate::error::AppResult;
use crate::paths;

fn read_json_or_default<T: Default + serde::de::DeserializeOwned>(path: &std::path::Path) -> AppResult<T> {
    if !path.exists() {
        return Ok(T::default());
    }
    let text = std::fs::read_to_string(path)?;
    match serde_json::from_str::<T>(&text) {
        Ok(v) => Ok(v),
        Err(_) => Ok(T::default()),
    }
}

fn write_json_atomic<T: serde::Serialize>(path: &std::path::Path, value: &T) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(value)?;
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

// ----- config.json -----

#[tauri::command]
pub fn config_load() -> AppResult<Config> {
    read_json_or_default(&paths::config_path()?)
}

#[tauri::command]
pub fn config_save(config: Config) -> AppResult<()> {
    write_json_atomic(&paths::config_path()?, &config)
}

// ----- app-state.json -----

#[tauri::command]
pub fn app_state_load() -> AppResult<AppState> {
    read_json_or_default(&paths::app_state_path()?)
}

#[tauri::command]
pub fn app_state_save(state: AppState) -> AppResult<()> {
    write_json_atomic(&paths::app_state_path()?, &state)
}

// ----- .env (FAL_KEY) -----

const KEY_NAME: &str = "FAL_KEY";

#[tauri::command]
pub fn fal_key_get() -> AppResult<String> {
    let path = paths::env_path()?;
    if !path.exists() {
        return Ok(String::new());
    }
    let text = std::fs::read_to_string(path)?;
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(rest) = line.strip_prefix(&format!("{KEY_NAME}=")) {
            return Ok(rest.trim_matches('"').to_string());
        }
    }
    Ok(String::new())
}

#[tauri::command]
pub fn fal_key_set(key: String) -> AppResult<()> {
    let path = paths::env_path()?;
    let content = format!("{KEY_NAME}={}\n", key);
    std::fs::write(path, content)?;
    Ok(())
}
