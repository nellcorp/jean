//! Linear project-management commands: projects, milestones, documents, project
//! updates, workflow states, users, labels, cycles, plus issue/comment/project
//! writes. These reuse the Linear GraphQL client and config resolution from
//! [`super::linear_issues`] and return lightly-shaped `serde_json::Value` subtrees
//! so they can be exposed directly through the Jean MCP without per-entity structs.
//!
//! Linear API reference: dates use the `TimelessDate` scalar (`"YYYY-MM-DD"`),
//! project status is read via `status { type name }` (the `state` field is
//! deprecated), documents store markdown in `content`, and all mutations return
//! `{ success, <entity> }`. Issue `priority` is 0..4 (0 none, 1 urgent … 4 low);
//! project-update `health` is `onTrack` | `atRisk` | `offTrack`.

use serde_json::{json, Value};
use tauri::AppHandle;

use super::linear_issues::{get_linear_config, linear_graphql};

/// Run a read query and return the `data` object, erroring if absent.
async fn query_data(
    app: &AppHandle,
    project_id: &str,
    query: &str,
    variables: Option<Value>,
) -> Result<Value, String> {
    let config = get_linear_config(app, project_id)?;
    let resp = linear_graphql(&config.api_key, query, variables).await?;
    resp.get("data")
        .cloned()
        .ok_or_else(|| "Missing data in Linear response".to_string())
}

/// Run a mutation and return the payload object, erroring when `success` is false.
async fn mutate(
    app: &AppHandle,
    project_id: &str,
    query: &str,
    variables: Option<Value>,
    payload_field: &str,
) -> Result<Value, String> {
    let config = get_linear_config(app, project_id)?;
    let resp = linear_graphql(&config.api_key, query, variables).await?;
    let payload = resp
        .get("data")
        .and_then(|d| d.get(payload_field))
        .cloned()
        .ok_or_else(|| format!("Missing {payload_field} in Linear response"))?;
    if payload.get("success").and_then(|s| s.as_bool()) == Some(false) {
        return Err(format!("Linear {payload_field} reported success=false"));
    }
    Ok(payload)
}

/// Resolve the effective team id: explicit override wins, else the project's
/// configured team filter.
fn resolve_team(
    app: &AppHandle,
    project_id: &str,
    explicit: Option<String>,
) -> Result<Option<String>, String> {
    if explicit.as_deref().is_some_and(|t| !t.is_empty()) {
        return Ok(explicit);
    }
    Ok(get_linear_config(app, project_id)?.team_id)
}

/// Resolve the effective Linear project id: explicit override wins, else the
/// project's configured project filter.
fn resolve_linear_project(
    app: &AppHandle,
    project_id: &str,
    explicit: Option<String>,
) -> Result<Option<String>, String> {
    if explicit.as_deref().is_some_and(|p| !p.is_empty()) {
        return Ok(explicit);
    }
    Ok(get_linear_config(app, project_id)?.project_filter_id)
}

// =============================================================================
// Reads
// =============================================================================

const PROJECT_FIELDS: &str = r#"
    id name description url
    progress
    startDate targetDate
    status { id name type color }
    health
    priority priorityLabel
    lead { id name displayName email }
    members { nodes { id name displayName email } }
    teams { nodes { id name key } }
"#;

/// Get a single Linear project with status, lead, members, teams, and milestones.
pub async fn get_linear_project(
    app: AppHandle,
    project_id: String,
    linear_project_id: Option<String>,
) -> Result<Value, String> {
    let id = resolve_linear_project(&app, &project_id, linear_project_id)?
        .ok_or("No Linear project id provided or configured for this project")?;
    let query = format!(
        r#"query GetProject($id: String!) {{
    project(id: $id) {{{PROJECT_FIELDS}
        projectMilestones(first: 100) {{
            nodes {{ id name description targetDate sortOrder }}
        }}
    }}
}}"#
    );
    let data = query_data(&app, &project_id, &query, Some(json!({ "id": id }))).await?;
    data.get("project")
        .cloned()
        .ok_or_else(|| "Linear project not found".to_string())
}

/// List milestones for a Linear project.
pub async fn list_linear_milestones(
    app: AppHandle,
    project_id: String,
    linear_project_id: Option<String>,
) -> Result<Value, String> {
    let id = resolve_linear_project(&app, &project_id, linear_project_id)?
        .ok_or("No Linear project id provided or configured for this project")?;
    let query = r#"query Milestones($id: String!) {
    project(id: $id) {
        projectMilestones(first: 100) {
            nodes { id name description targetDate sortOrder }
        }
    }
}"#;
    let data = query_data(&app, &project_id, query, Some(json!({ "id": id }))).await?;
    Ok(data
        .get("project")
        .and_then(|p| p.get("projectMilestones"))
        .and_then(|m| m.get("nodes"))
        .cloned()
        .unwrap_or_else(|| json!([])))
}

/// List documents, optionally scoped to a Linear project (defaults to the
/// configured project; pass an empty linear_project_id via `all=true` semantics
/// by omitting the configured filter is not supported — use the project scope).
pub async fn list_linear_documents(
    app: AppHandle,
    project_id: String,
    linear_project_id: Option<String>,
) -> Result<Value, String> {
    let scoped = resolve_linear_project(&app, &project_id, linear_project_id)?;
    let (query, variables) = match scoped {
        Some(id) => (
            r#"query Docs($filter: DocumentFilter) {
    documents(first: 100, filter: $filter) {
        nodes { id title url updatedAt project { id name } }
    }
}"#
            .to_string(),
            Some(json!({ "filter": { "project": { "id": { "eq": id } } } })),
        ),
        None => (
            r#"query Docs {
    documents(first: 100) {
        nodes { id title url updatedAt project { id name } }
    }
}"#
            .to_string(),
            None,
        ),
    };
    let data = query_data(&app, &project_id, &query, variables).await?;
    Ok(data
        .get("documents")
        .and_then(|d| d.get("nodes"))
        .cloned()
        .unwrap_or_else(|| json!([])))
}

/// Get a single document with its markdown content.
pub async fn get_linear_document(
    app: AppHandle,
    project_id: String,
    document_id: String,
) -> Result<Value, String> {
    let query = r#"query Doc($id: String!) {
    document(id: $id) {
        id title content url icon color slugId
        project { id name }
        creator { id name displayName }
    }
}"#;
    let data = query_data(&app, &project_id, query, Some(json!({ "id": document_id }))).await?;
    data.get("document")
        .cloned()
        .ok_or_else(|| "Linear document not found".to_string())
}

/// List a Linear project's status updates (the project-update posts).
pub async fn list_linear_project_updates(
    app: AppHandle,
    project_id: String,
    linear_project_id: Option<String>,
) -> Result<Value, String> {
    let id = resolve_linear_project(&app, &project_id, linear_project_id)?
        .ok_or("No Linear project id provided or configured for this project")?;
    let query = r#"query Updates($id: String!) {
    project(id: $id) {
        projectUpdates(first: 50) {
            nodes { id body health createdAt editedAt url user { id name displayName } }
        }
    }
}"#;
    let data = query_data(&app, &project_id, query, Some(json!({ "id": id }))).await?;
    Ok(data
        .get("project")
        .and_then(|p| p.get("projectUpdates"))
        .and_then(|u| u.get("nodes"))
        .cloned()
        .unwrap_or_else(|| json!([])))
}

/// List a team's workflow states (issue statuses).
pub async fn list_linear_workflow_states(
    app: AppHandle,
    project_id: String,
    team_id: Option<String>,
) -> Result<Value, String> {
    let team = resolve_team(&app, &project_id, team_id)?;
    let (query, variables) = match team {
        Some(t) => (
            r#"query States($t: ID!) {
    workflowStates(first: 100, filter: { team: { id: { eq: $t } } }) {
        nodes { id name type position color }
    }
}"#
            .to_string(),
            Some(json!({ "t": t })),
        ),
        None => (
            r#"query States {
    workflowStates(first: 100) {
        nodes { id name type position color }
    }
}"#
            .to_string(),
            None,
        ),
    };
    let data = query_data(&app, &project_id, &query, variables).await?;
    Ok(data
        .get("workflowStates")
        .and_then(|s| s.get("nodes"))
        .cloned()
        .unwrap_or_else(|| json!([])))
}

/// List workspace users (for assignment).
pub async fn list_linear_users(app: AppHandle, project_id: String) -> Result<Value, String> {
    let query = r#"query Users {
    users(first: 250) {
        nodes { id name displayName email active }
    }
}"#;
    let data = query_data(&app, &project_id, query, None).await?;
    Ok(data
        .get("users")
        .and_then(|u| u.get("nodes"))
        .cloned()
        .unwrap_or_else(|| json!([])))
}

/// List issue labels.
pub async fn list_linear_labels(app: AppHandle, project_id: String) -> Result<Value, String> {
    let query = r#"query Labels {
    issueLabels(first: 250) {
        nodes { id name color isGroup parent { id name } }
    }
}"#;
    let data = query_data(&app, &project_id, query, None).await?;
    Ok(data
        .get("issueLabels")
        .and_then(|l| l.get("nodes"))
        .cloned()
        .unwrap_or_else(|| json!([])))
}

/// List a team's cycles.
pub async fn list_linear_cycles(
    app: AppHandle,
    project_id: String,
    team_id: Option<String>,
) -> Result<Value, String> {
    let team = resolve_team(&app, &project_id, team_id)?;
    let (query, variables) = match team {
        Some(t) => (
            r#"query Cycles($t: ID!) {
    cycles(first: 50, filter: { team: { id: { eq: $t } } }) {
        nodes { id number name startsAt endsAt }
    }
}"#
            .to_string(),
            Some(json!({ "t": t })),
        ),
        None => (
            r#"query Cycles {
    cycles(first: 50) {
        nodes { id number name startsAt endsAt }
    }
}"#
            .to_string(),
            None,
        ),
    };
    let data = query_data(&app, &project_id, &query, variables).await?;
    Ok(data
        .get("cycles")
        .and_then(|c| c.get("nodes"))
        .cloned()
        .unwrap_or_else(|| json!([])))
}

// =============================================================================
// Writes
// =============================================================================

/// Strip null entries from an input object so unspecified fields are omitted
/// rather than sent as explicit nulls (which Linear rejects for some fields).
fn clean_input(mut input: Value) -> Value {
    if let Some(obj) = input.as_object_mut() {
        obj.retain(|_, v| !v.is_null());
    }
    input
}

/// Create an issue. `input` accepts: teamId (defaults to configured team), title,
/// description, stateId, assigneeId, priority (0-4), labelIds, projectId
/// (defaults to configured Linear project), projectMilestoneId, estimate,
/// parentId, dueDate ("YYYY-MM-DD"), cycleId.
pub async fn create_linear_issue(
    app: AppHandle,
    project_id: String,
    input: Value,
) -> Result<Value, String> {
    let mut input = clean_input(input);
    // Default teamId / projectId from the Jean project's Linear config.
    if input.get("teamId").is_none() {
        if let Some(team) = resolve_team(&app, &project_id, None)? {
            input["teamId"] = json!(team);
        }
    }
    if input.get("projectId").is_none() {
        if let Some(lp) = resolve_linear_project(&app, &project_id, None)? {
            input["projectId"] = json!(lp);
        }
    }
    if input.get("teamId").is_none() {
        return Err("create_linear_issue requires a teamId (none provided and no team configured for this project)".to_string());
    }
    let query = r#"mutation IssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) {
        success
        issue { id identifier title url state { id name } }
    }
}"#;
    mutate(
        &app,
        &project_id,
        query,
        Some(json!({ "input": input })),
        "issueCreate",
    )
    .await
}

/// Update an issue by id. `input` accepts the same fields as create (all optional).
pub async fn update_linear_issue(
    app: AppHandle,
    project_id: String,
    issue_id: String,
    input: Value,
) -> Result<Value, String> {
    let input = clean_input(input);
    let query = r#"mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) {
        success
        issue { id identifier title url state { id name } assignee { id displayName } priority }
    }
}"#;
    mutate(
        &app,
        &project_id,
        query,
        Some(json!({ "id": issue_id, "input": input })),
        "issueUpdate",
    )
    .await
}

/// Archive an issue (Linear's soft-delete; issues cannot be trashed directly).
pub async fn archive_linear_issue(
    app: AppHandle,
    project_id: String,
    issue_id: String,
) -> Result<Value, String> {
    let query = r#"mutation IssueArchive($id: String!) {
    issueArchive(id: $id) { success }
}"#;
    mutate(
        &app,
        &project_id,
        query,
        Some(json!({ "id": issue_id })),
        "issueArchive",
    )
    .await
}

/// Create an issue label. `input` accepts: name (required), color (hex),
/// description, parentId (label group), isGroup, teamId (defaults to the
/// configured team; omit/empty for a workspace-wide label).
pub async fn create_linear_label(
    app: AppHandle,
    project_id: String,
    input: Value,
) -> Result<Value, String> {
    let mut input = clean_input(input);
    if input.get("name").and_then(|n| n.as_str()).unwrap_or("").is_empty() {
        return Err("create_linear_label requires a name".to_string());
    }
    // Default to the configured team so the label is scoped to it. Callers can
    // pass an empty teamId to force a workspace-wide label.
    if input.get("teamId").is_none() {
        if let Some(team) = resolve_team(&app, &project_id, None)? {
            input["teamId"] = json!(team);
        }
    }
    let query = r#"mutation LabelCreate($input: IssueLabelCreateInput!) {
    issueLabelCreate(input: $input) {
        success
        issueLabel { id name color }
    }
}"#;
    mutate(
        &app,
        &project_id,
        query,
        Some(json!({ "input": input })),
        "issueLabelCreate",
    )
    .await
}

/// Attach a label to an issue.
pub async fn add_linear_issue_label(
    app: AppHandle,
    project_id: String,
    issue_id: String,
    label_id: String,
) -> Result<Value, String> {
    let query = r#"mutation IssueAddLabel($id: String!, $labelId: String!) {
    issueAddLabel(id: $id, labelId: $labelId) {
        success
        issue { id identifier labels { nodes { id name } } }
    }
}"#;
    mutate(
        &app,
        &project_id,
        query,
        Some(json!({ "id": issue_id, "labelId": label_id })),
        "issueAddLabel",
    )
    .await
}

/// Remove a label from an issue.
pub async fn remove_linear_issue_label(
    app: AppHandle,
    project_id: String,
    issue_id: String,
    label_id: String,
) -> Result<Value, String> {
    let query = r#"mutation IssueRemoveLabel($id: String!, $labelId: String!) {
    issueRemoveLabel(id: $id, labelId: $labelId) {
        success
        issue { id identifier labels { nodes { id name } } }
    }
}"#;
    mutate(
        &app,
        &project_id,
        query,
        Some(json!({ "id": issue_id, "labelId": label_id })),
        "issueRemoveLabel",
    )
    .await
}

/// Add a comment to an issue.
pub async fn create_linear_comment(
    app: AppHandle,
    project_id: String,
    issue_id: String,
    body: String,
) -> Result<Value, String> {
    let query = r#"mutation CommentCreate($input: CommentCreateInput!) {
    commentCreate(input: $input) {
        success
        comment { id body url }
    }
}"#;
    mutate(
        &app,
        &project_id,
        query,
        Some(json!({ "input": { "issueId": issue_id, "body": body } })),
        "commentCreate",
    )
    .await
}

/// Create a project. `input` accepts: name (required), teamIds (defaults to
/// configured team), description, content, leadId, memberIds, targetDate,
/// startDate, statusId, priority.
pub async fn create_linear_project(
    app: AppHandle,
    project_id: String,
    input: Value,
) -> Result<Value, String> {
    let mut input = clean_input(input);
    if input.get("teamIds").is_none() {
        if let Some(team) = resolve_team(&app, &project_id, None)? {
            input["teamIds"] = json!([team]);
        }
    }
    if input.get("name").and_then(|n| n.as_str()).unwrap_or("").is_empty() {
        return Err("create_linear_project requires a name".to_string());
    }
    if input.get("teamIds").is_none() {
        return Err("create_linear_project requires teamIds (none provided and no team configured for this project)".to_string());
    }
    let query = r#"mutation ProjectCreate($input: ProjectCreateInput!) {
    projectCreate(input: $input) {
        success
        project { id name url status { name type } }
    }
}"#;
    mutate(
        &app,
        &project_id,
        query,
        Some(json!({ "input": input })),
        "projectCreate",
    )
    .await
}

/// Update a Linear project by id (defaults to the configured Linear project).
pub async fn update_linear_project(
    app: AppHandle,
    project_id: String,
    linear_project_id: Option<String>,
    input: Value,
) -> Result<Value, String> {
    let id = resolve_linear_project(&app, &project_id, linear_project_id)?
        .ok_or("No Linear project id provided or configured for this project")?;
    let input = clean_input(input);
    let query = r#"mutation ProjectUpdate($id: String!, $input: ProjectUpdateInput!) {
    projectUpdate(id: $id, input: $input) {
        success
        project { id name url status { name type } targetDate startDate }
    }
}"#;
    mutate(
        &app,
        &project_id,
        query,
        Some(json!({ "id": id, "input": input })),
        "projectUpdate",
    )
    .await
}

/// Create a milestone in a Linear project (defaults to configured project).
/// `input` accepts: name (required), targetDate, description, sortOrder.
pub async fn create_linear_milestone(
    app: AppHandle,
    project_id: String,
    linear_project_id: Option<String>,
    input: Value,
) -> Result<Value, String> {
    let id = resolve_linear_project(&app, &project_id, linear_project_id)?
        .ok_or("No Linear project id provided or configured for this project")?;
    let mut input = clean_input(input);
    if input.get("name").and_then(|n| n.as_str()).unwrap_or("").is_empty() {
        return Err("create_linear_milestone requires a name".to_string());
    }
    input["projectId"] = json!(id);
    let query = r#"mutation MilestoneCreate($input: ProjectMilestoneCreateInput!) {
    projectMilestoneCreate(input: $input) {
        success
        projectMilestone { id name targetDate description }
    }
}"#;
    mutate(
        &app,
        &project_id,
        query,
        Some(json!({ "input": input })),
        "projectMilestoneCreate",
    )
    .await
}

/// Update a milestone by id. `input` accepts: name, description, targetDate,
/// sortOrder, projectId (to move).
pub async fn update_linear_milestone(
    app: AppHandle,
    project_id: String,
    milestone_id: String,
    input: Value,
) -> Result<Value, String> {
    let input = clean_input(input);
    let query = r#"mutation MilestoneUpdate($id: String!, $input: ProjectMilestoneUpdateInput!) {
    projectMilestoneUpdate(id: $id, input: $input) {
        success
        projectMilestone { id name targetDate description }
    }
}"#;
    mutate(
        &app,
        &project_id,
        query,
        Some(json!({ "id": milestone_id, "input": input })),
        "projectMilestoneUpdate",
    )
    .await
}

/// Delete a milestone by id.
pub async fn delete_linear_milestone(
    app: AppHandle,
    project_id: String,
    milestone_id: String,
) -> Result<Value, String> {
    let query = r#"mutation MilestoneDelete($id: String!) {
    projectMilestoneDelete(id: $id) { success }
}"#;
    mutate(
        &app,
        &project_id,
        query,
        Some(json!({ "id": milestone_id })),
        "projectMilestoneDelete",
    )
    .await
}

/// Create a document. `input` accepts: title (required), content (markdown),
/// projectId (defaults to configured project), icon, color.
pub async fn create_linear_document(
    app: AppHandle,
    project_id: String,
    input: Value,
) -> Result<Value, String> {
    let mut input = clean_input(input);
    if input
        .get("title")
        .and_then(|n| n.as_str())
        .unwrap_or("")
        .is_empty()
    {
        return Err("create_linear_document requires a title".to_string());
    }
    if input.get("projectId").is_none() {
        if let Some(lp) = resolve_linear_project(&app, &project_id, None)? {
            input["projectId"] = json!(lp);
        }
    }
    let query = r#"mutation DocumentCreate($input: DocumentCreateInput!) {
    documentCreate(input: $input) {
        success
        document { id title url }
    }
}"#;
    mutate(
        &app,
        &project_id,
        query,
        Some(json!({ "input": input })),
        "documentCreate",
    )
    .await
}

/// Update a document by id. `input` accepts: title, content, projectId, icon, color.
pub async fn update_linear_document(
    app: AppHandle,
    project_id: String,
    document_id: String,
    input: Value,
) -> Result<Value, String> {
    let input = clean_input(input);
    let query = r#"mutation DocumentUpdate($id: String!, $input: DocumentUpdateInput!) {
    documentUpdate(id: $id, input: $input) {
        success
        document { id title content url }
    }
}"#;
    mutate(
        &app,
        &project_id,
        query,
        Some(json!({ "id": document_id, "input": input })),
        "documentUpdate",
    )
    .await
}

/// Delete a document by id.
pub async fn delete_linear_document(
    app: AppHandle,
    project_id: String,
    document_id: String,
) -> Result<Value, String> {
    let query = r#"mutation DocumentDelete($id: String!) {
    documentDelete(id: $id) { success }
}"#;
    mutate(
        &app,
        &project_id,
        query,
        Some(json!({ "id": document_id })),
        "documentDelete",
    )
    .await
}

/// Post a project status update. `body` is markdown; `health` is one of
/// onTrack | atRisk | offTrack.
pub async fn create_linear_project_update(
    app: AppHandle,
    project_id: String,
    linear_project_id: Option<String>,
    body: Option<String>,
    health: Option<String>,
) -> Result<Value, String> {
    let id = resolve_linear_project(&app, &project_id, linear_project_id)?
        .ok_or("No Linear project id provided or configured for this project")?;
    let mut input = json!({ "projectId": id });
    if let Some(body) = body.filter(|b| !b.is_empty()) {
        input["body"] = json!(body);
    }
    if let Some(health) = health.filter(|h| !h.is_empty()) {
        input["health"] = json!(health);
    }
    let query = r#"mutation ProjectUpdateCreate($input: ProjectUpdateCreateInput!) {
    projectUpdateCreate(input: $input) {
        success
        projectUpdate { id body health url createdAt }
    }
}"#;
    mutate(
        &app,
        &project_id,
        query,
        Some(json!({ "input": input })),
        "projectUpdateCreate",
    )
    .await
}

/// Create a formal relation between two issues (blocks / duplicate / related).
///
/// Semantics: `issue_id` <type> `related_issue_id`. For `blocks`, `issue_id`
/// blocks `related_issue_id`. So "issue A is blocked by issue B" is created by
/// passing `issue_id = B`, `related_issue_id = A`, `relation_type = "blocks"`.
pub async fn create_linear_issue_relation(
    app: AppHandle,
    project_id: String,
    issue_id: String,
    related_issue_id: String,
    relation_type: String,
) -> Result<Value, String> {
    let query = r#"mutation IssueRelationCreate($input: IssueRelationCreateInput!) {
    issueRelationCreate(input: $input) {
        success
        issueRelation {
            id
            type
            issue { id identifier }
            relatedIssue { id identifier }
        }
    }
}"#;
    let input = json!({
        "issueId": issue_id,
        "relatedIssueId": related_issue_id,
        "type": relation_type,
    });
    mutate(
        &app,
        &project_id,
        query,
        Some(json!({ "input": input })),
        "issueRelationCreate",
    )
    .await
}

/// Delete an issue relation by its relation id (from list_linear_issue_relations).
pub async fn delete_linear_issue_relation(
    app: AppHandle,
    project_id: String,
    relation_id: String,
) -> Result<Value, String> {
    let query = r#"mutation IssueRelationDelete($id: String!) {
    issueRelationDelete(id: $id) {
        success
    }
}"#;
    mutate(
        &app,
        &project_id,
        query,
        Some(json!({ "id": relation_id })),
        "issueRelationDelete",
    )
    .await
}

/// List an issue's relations in both directions. `relations` are where this
/// issue is the source (for type `blocks`: this issue blocks `relatedIssue`);
/// `inverseRelations` are where this issue is the target (for type `blocks`:
/// `issue` blocks this one — i.e. this issue is blocked by `issue`).
pub async fn list_linear_issue_relations(
    app: AppHandle,
    project_id: String,
    issue_id: String,
) -> Result<Value, String> {
    let query = r#"query IssueRelations($id: String!) {
    issue(id: $id) {
        id
        identifier
        relations(first: 100) {
            nodes { id type relatedIssue { id identifier title } }
        }
        inverseRelations(first: 100) {
            nodes { id type issue { id identifier title } }
        }
    }
}"#;
    let data = query_data(&app, &project_id, query, Some(json!({ "id": issue_id }))).await?;
    data.get("issue")
        .cloned()
        .ok_or_else(|| "Linear issue not found".to_string())
}
