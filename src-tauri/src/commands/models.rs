use serde::Deserialize;
use serde_json::Value;

use crate::domain::{ModelEntry, ModelInput, ModelNode, ModelOutput, RefRoleSpec};
use crate::error::AppResult;
use crate::paths;

// Shape of the on-disk model file (family-level wrapper).
#[derive(Debug, Deserialize)]
struct ModelFile {
    #[serde(default)]
    family: String,
    #[serde(default)]
    category: String,
    #[serde(default)]
    nodes: Vec<RawNode>,
}

#[derive(Debug, Deserialize)]
struct RawNode {
    id: String,
    name: String,
    endpoint: String,
    #[serde(default)]
    inputs: Vec<ModelInput>,
    #[serde(default)]
    outputs: Vec<ModelOutput>,
    #[serde(default)]
    ref_roles: Option<Vec<RefRoleSpec>>,
    #[serde(default)]
    parameters: Vec<Value>,
    // Optional forward-compat: if a model file starts declaring these, pass through.
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    batch_field: Option<String>,
}

fn infer_kind(outputs: &[ModelOutput], declared: &Option<String>) -> String {
    if let Some(k) = declared {
        return k.clone();
    }
    let any_video = outputs.iter().any(|o| o.data_type.eq_ignore_ascii_case("VIDEO"));
    if any_video { "video".into() } else { "image".into() }
}

fn infer_batch_field(parameters: &[Value], declared: &Option<String>) -> Option<String> {
    if let Some(b) = declared {
        return Some(b.clone());
    }
    for p in parameters {
        let api_field = p.get("api_field").and_then(|v| v.as_str()).unwrap_or("");
        if matches!(api_field, "num_images" | "num_samples" | "n" | "batch_size") {
            return Some(api_field.to_string());
        }
    }
    None
}

/// Annotate ref_roles with exclusive/named defaults so the UI doesn't need to know every
/// legacy model. start/end → exclusive; "element" → named.
fn annotate_roles(roles: Option<Vec<RefRoleSpec>>) -> Option<Vec<RefRoleSpec>> {
    roles.map(|rs| {
        rs.into_iter()
            .map(|mut r| {
                if r.exclusive.is_none() && (r.role == "start" || r.role == "end") {
                    r.exclusive = Some(true);
                }
                if r.named.is_none() && r.role == "element" {
                    r.named = Some(true);
                }
                r
            })
            .collect()
    })
}

#[tauri::command]
pub fn models_load() -> AppResult<Vec<ModelEntry>> {
    let dir = paths::models_dir()?;
    let mut entries = Vec::new();

    let mut files: Vec<_> = std::fs::read_dir(&dir)?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .and_then(|x| x.to_str())
                .map(|x| x.eq_ignore_ascii_case("json"))
                .unwrap_or(false)
        })
        .collect();
    files.sort_by_key(|e| e.file_name());

    for entry in files {
        let path = entry.path();
        let text = match std::fs::read_to_string(&path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        let file: ModelFile = match serde_json::from_str(&text) {
            Ok(f) => f,
            Err(_) => continue,
        };
        for raw in file.nodes {
            let kind = infer_kind(&raw.outputs, &raw.kind);
            let batch_field = infer_batch_field(&raw.parameters, &raw.batch_field);
            let node = ModelNode {
                id: raw.id,
                name: raw.name,
                endpoint: raw.endpoint,
                kind,
                inputs: raw.inputs,
                outputs: raw.outputs,
                ref_roles: annotate_roles(raw.ref_roles),
                parameters: raw.parameters,
                batch_field,
            };
            entries.push(ModelEntry {
                family: file.family.clone(),
                category: file.category.clone(),
                node,
            });
        }
    }

    Ok(entries)
}
