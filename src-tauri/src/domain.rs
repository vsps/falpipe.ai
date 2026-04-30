use serde::{Deserialize, Serialize};
use serde_json::Value;

// All types here must match src/lib/types.ts exactly.

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInput {
    pub name: String,
    pub data_type: String,
    pub api_field: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub api_format: Option<String>,
    #[serde(default)]
    pub required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelOutput {
    pub name: String,
    pub data_type: String,
    pub api_field: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefRoleSpec {
    pub role: String,
    pub api_field: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub max: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub exclusive: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub named: Option<bool>,
}

/// The model files on disk store parameters loosely — we pass them through as a
/// JSON Value so the UI can render them with minimal Rust-side ceremony.
pub type Parameter = Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelNode {
    pub id: String,
    pub name: String,
    pub endpoint: String,
    pub kind: String, // "image" | "video"
    pub inputs: Vec<ModelInput>,
    pub outputs: Vec<ModelOutput>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub ref_roles: Option<Vec<RefRoleSpec>>,
    pub parameters: Vec<Parameter>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub batch_field: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelEntry {
    pub family: String,
    pub category: String,
    pub node: ModelNode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowBounds {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub x: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub y: Option<i32>,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorOverrides {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub bg: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub panel: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub surface: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub accent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub window_bounds: WindowBounds,
    #[serde(default)]
    pub project_path: String,
    #[serde(default)]
    pub last_sequence: String,
    #[serde(default)]
    pub last_shot: String,
    #[serde(default)]
    pub last_model: String,
    #[serde(default)]
    pub test_mode: bool,
    #[serde(default)]
    pub test_image_path: String,
    #[serde(default)]
    pub ffmpeg_path: String,
    #[serde(default = "default_max_concurrent_jobs")]
    pub max_concurrent_jobs: u32,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub colors: Option<ColorOverrides>,
}

fn default_max_concurrent_jobs() -> u32 { 3 }

impl Default for Config {
    fn default() -> Self {
        Self {
            window_bounds: WindowBounds { x: None, y: None, width: 1600, height: 1000 },
            project_path: String::new(),
            last_sequence: String::new(),
            last_shot: String::new(),
            last_model: String::new(),
            test_mode: false,
            test_image_path: String::new(),
            ffmpeg_path: String::new(),
            max_concurrent_jobs: default_max_concurrent_jobs(),
            colors: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum RoleAssignment {
    Source,
    Start,
    End,
    #[serde(rename_all = "camelCase")]
    Element { group_name: String, frontal: bool },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefImage {
    pub path: String,
    pub role_assignment: Option<RoleAssignment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    #[serde(default)]
    pub project_path: String,
    #[serde(default)]
    pub last_sequence: String,
    #[serde(default)]
    pub last_shot: String,
    #[serde(default)]
    pub last_model: String,
    #[serde(default)]
    pub sequence_prompt: String,
    /// Legacy single-string shot prompt. Read for back-compat; new code writes
    /// `shot_prompts` instead. Kept here so older saved AppState still loads.
    #[serde(default)]
    pub shot_prompt: String,
    #[serde(default)]
    pub shot_prompts: Vec<String>,
    #[serde(default)]
    pub settings: Value,
    #[serde(default)]
    pub ref_images: Vec<RefImage>,
    #[serde(default = "one")]
    pub iterations: u32,
    #[serde(default = "default_gallery_height")]
    pub gallery_height: u32,
    #[serde(default = "default_thumb_col_width")]
    pub thumb_col_width: u32,
    #[serde(default = "default_log_height")]
    pub log_height: u32,
}

fn one() -> u32 { 1 }
fn default_gallery_height() -> u32 { 400 }
fn default_thumb_col_width() -> u32 { 180 }
fn default_log_height() -> u32 { 78 }

impl Default for AppState {
    fn default() -> Self {
        Self {
            project_path: String::new(),
            last_sequence: String::new(),
            last_shot: String::new(),
            last_model: String::new(),
            sequence_prompt: String::new(),
            shot_prompt: String::new(),
            shot_prompts: vec![],
            settings: Value::Object(Default::default()),
            ref_images: vec![],
            iterations: 1,
            gallery_height: 400,
            thumb_col_width: 180,
            log_height: 78,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptEntry {
    pub timestamp: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SequenceSidecar {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub prompt_history: Vec<PromptEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ShotSidecar {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub prompt_history: Vec<PromptEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryImage {
    pub filename: String,
    pub path: String,
    pub metadata_path: String,
    pub is_video: bool,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub thumb_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GalleryColumn {
    pub id: String,
    pub version: String,
    pub is_src: bool,
    pub images: Vec<GalleryImage>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub timestamp: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub model_name: Option<String>,
}
