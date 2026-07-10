//! Outline (getoutline.com / self-hosted knowledge base) integration.
//!
//! Mirrors the Linear integration: an API token + instance URL are resolved from
//! per-project settings falling back to global preferences, and each operation is
//! a Tauri command returning a lightly-shaped `serde_json::Value` so it can be
//! exposed through the Jean MCP without per-entity structs.
//!
//! Outline's API is RPC over HTTP: every call is `POST {base}/api/<resource>.<method>`
//! with a JSON body, auth via `Authorization: Bearer <token>`. Responses use the
//! envelope `{ ok, data, pagination?, error?, message? }`. Documents store markdown
//! in `text`; list endpoints paginate via `offset`/`limit` (default 25, max 100).

use serde_json::{json, Value};
use tauri::AppHandle;

use super::storage::load_projects_data;

/// Outline config resolved from project + global preferences.
pub(crate) struct OutlineConfig {
    pub(crate) api_key: String,
    pub(crate) base_url: String,
    pub(crate) collection_id: Option<String>,
}

/// Resolve Outline config: the API token falls back from project to global
/// preferences; the instance URL is global. Errors when either is unset.
pub(crate) fn get_outline_config(
    app: &AppHandle,
    project_id: &str,
) -> Result<OutlineConfig, String> {
    let data = load_projects_data(app)?;
    let project = data
        .find_project(project_id)
        .ok_or_else(|| format!("Project not found: {project_id}"))?;

    let collection_id = project
        .outline_collection_id
        .clone()
        .filter(|c| !c.is_empty());

    let prefs = crate::load_preferences_sync(app)?;

    let api_key = project
        .outline_api_key
        .as_ref()
        .filter(|k| !k.is_empty())
        .or(prefs.outline_api_key.as_ref().filter(|k| !k.is_empty()))
        .cloned()
        .ok_or("No Outline API token configured. Add one in Settings → Integrations, or override per-project.")?;

    let base_url = prefs
        .outline_url
        .as_ref()
        .map(|u| u.trim().trim_end_matches('/').to_string())
        .filter(|u| !u.is_empty())
        .ok_or("No Outline URL configured. Set your Outline instance URL in Settings → Integrations.")?;

    Ok(OutlineConfig {
        api_key,
        base_url,
        collection_id,
    })
}

/// POST to an Outline endpoint (e.g. "documents.list") and return the `data`
/// field, erroring on a non-2xx response or `ok: false` envelope.
async fn outline_api(config: &OutlineConfig, path: &str, body: Value) -> Result<Value, String> {
    let endpoint = format!("{}/api/{path}", config.base_url);
    let client = reqwest::Client::new();
    let response = client
        .post(&endpoint)
        .bearer_auth(&config.api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Outline API request failed: {e}"))?;

    let status = response.status();
    let json: Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Outline response: {e}"))?;

    if json.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        let message = json
            .get("message")
            .or_else(|| json.get("error"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        if status.as_u16() == 401 {
            return Err(
                "Outline API token is invalid or unauthorized. Update it in settings.".to_string(),
            );
        }
        return Err(format!("Outline API error ({status}): {message}"));
    }

    // Most endpoints return a `data` object; a few (e.g. documents.delete) return
    // only `{ ok: true }`. Treat a missing `data` on an ok response as success.
    Ok(json
        .get("data")
        .cloned()
        .unwrap_or_else(|| json!({ "success": true })))
}

/// Strip null entries so unspecified fields are omitted from the request body.
fn clean_input(mut input: Value) -> Value {
    if let Some(obj) = input.as_object_mut() {
        obj.retain(|_, v| !v.is_null());
    }
    input
}

// =============================================================================
// Reads
// =============================================================================

/// List Outline collections.
#[tauri::command]
pub async fn list_outline_collections(
    app: AppHandle,
    project_id: String,
) -> Result<Value, String> {
    let config = get_outline_config(&app, &project_id)?;
    outline_api(&config, "collections.list", json!({ "limit": 100 })).await
}

/// List documents, scoped to the configured collection by default. Pass
/// `collection_id` to override; `all=true` paginates every document.
#[tauri::command]
pub async fn list_outline_documents(
    app: AppHandle,
    project_id: String,
    collection_id: Option<String>,
    all: Option<bool>,
    limit: Option<u32>,
) -> Result<Value, String> {
    let config = get_outline_config(&app, &project_id)?;
    let collection = collection_id
        .filter(|c| !c.is_empty())
        .or_else(|| config.collection_id.clone());

    let fetch_all = all.unwrap_or(false);
    let target = limit.unwrap_or(25);
    const MAX_PAGE: u32 = 100;

    let mut docs: Vec<Value> = Vec::new();
    let mut offset: u32 = 0;
    loop {
        let page_size = if fetch_all {
            MAX_PAGE
        } else {
            (target.saturating_sub(docs.len() as u32)).min(MAX_PAGE)
        };
        if page_size == 0 {
            break;
        }

        let mut body = json!({
            "limit": page_size,
            "offset": offset,
            "sort": "updatedAt",
            "direction": "DESC",
        });
        if let Some(c) = &collection {
            body["collectionId"] = json!(c);
        }

        let data = outline_api(&config, "documents.list", body).await?;
        let page = data.as_array().cloned().unwrap_or_default();
        let count = page.len() as u32;
        docs.extend(page);

        if count < page_size {
            break;
        }
        if !fetch_all && docs.len() as u32 >= target {
            break;
        }
        offset += count;
    }

    Ok(Value::Array(docs))
}

/// Get a single document (including its markdown `text`).
#[tauri::command]
pub async fn get_outline_document(
    app: AppHandle,
    project_id: String,
    document_id: String,
) -> Result<Value, String> {
    let config = get_outline_config(&app, &project_id)?;
    outline_api(&config, "documents.info", json!({ "id": document_id })).await
}

/// Full-text search documents, optionally scoped to a collection (defaults to
/// the configured collection).
#[tauri::command]
pub async fn search_outline_documents(
    app: AppHandle,
    project_id: String,
    query: String,
    collection_id: Option<String>,
) -> Result<Value, String> {
    let config = get_outline_config(&app, &project_id)?;
    let collection = collection_id
        .filter(|c| !c.is_empty())
        .or_else(|| config.collection_id.clone());
    let mut body = json!({ "query": query, "limit": 25 });
    if let Some(c) = &collection {
        body["collectionId"] = json!(c);
    }
    outline_api(&config, "documents.search", body).await
}

// =============================================================================
// Writes
// =============================================================================

/// Create a document. `input` accepts: title, text (markdown), collectionId
/// (defaults to the configured collection), parentDocumentId, publish (default
/// true), icon. A published document requires a collection or parent.
#[tauri::command]
pub async fn create_outline_document(
    app: AppHandle,
    project_id: String,
    input: Value,
) -> Result<Value, String> {
    let config = get_outline_config(&app, &project_id)?;
    let mut input = clean_input(input);
    if input.get("collectionId").is_none() && input.get("parentDocumentId").is_none() {
        if let Some(c) = &config.collection_id {
            input["collectionId"] = json!(c);
        }
    }
    if input.get("publish").is_none() {
        input["publish"] = json!(true);
    }
    if input.get("publish").and_then(|p| p.as_bool()) == Some(true)
        && input.get("collectionId").is_none()
        && input.get("parentDocumentId").is_none()
    {
        return Err("create_outline_document: a published document needs a collectionId (none provided and no collection configured for this project) or a parentDocumentId".to_string());
    }
    outline_api(&config, "documents.create", input).await
}

/// Update a document. `input` accepts: title, text (markdown), publish,
/// collectionId, icon, editMode ("replace"|"append"|"prepend"). `id` is required.
#[tauri::command]
pub async fn update_outline_document(
    app: AppHandle,
    project_id: String,
    document_id: String,
    input: Value,
) -> Result<Value, String> {
    let config = get_outline_config(&app, &project_id)?;
    let mut input = clean_input(input);
    input["id"] = json!(document_id);
    outline_api(&config, "documents.update", input).await
}

/// Archive a document.
#[tauri::command]
pub async fn archive_outline_document(
    app: AppHandle,
    project_id: String,
    document_id: String,
) -> Result<Value, String> {
    let config = get_outline_config(&app, &project_id)?;
    outline_api(&config, "documents.archive", json!({ "id": document_id })).await
}

/// Delete a document. `permanent=true` skips the trash.
#[tauri::command]
pub async fn delete_outline_document(
    app: AppHandle,
    project_id: String,
    document_id: String,
    permanent: Option<bool>,
) -> Result<Value, String> {
    let config = get_outline_config(&app, &project_id)?;
    outline_api(
        &config,
        "documents.delete",
        json!({ "id": document_id, "permanent": permanent.unwrap_or(false) }),
    )
    .await
}

/// Move a document to another collection and/or parent. `input` accepts:
/// collectionId, parentDocumentId, index.
#[tauri::command]
pub async fn move_outline_document(
    app: AppHandle,
    project_id: String,
    document_id: String,
    input: Value,
) -> Result<Value, String> {
    let config = get_outline_config(&app, &project_id)?;
    let mut input = clean_input(input);
    input["id"] = json!(document_id);
    outline_api(&config, "documents.move", input).await
}
