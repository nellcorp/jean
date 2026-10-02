//! Cross-backend skill management.
//!
//! Every CLI backend discovers skills from its own directory, so installing a
//! skill by hand means copying the same `SKILL.md` into up to eight places.
//! This module owns that fan-out: one paste in, one `SKILL.md` written per
//! selected backend, and a single list that reports which backends have it.
//!
//! Write targets mirror the read paths used by `projects::list_*_skills` so a
//! saved skill shows up in Jean's slash-command picker as well as in the CLI.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::projects::split_frontmatter;

const SKILL_FILE: &str = "SKILL.md";

/// Backends Jean can install a skill into, in display order.
const SKILL_BACKENDS: &[(&str, &str)] = &[
    ("claude", "Claude"),
    ("codex", "Codex"),
    ("opencode", "OpenCode"),
    ("cursor", "Cursor"),
    ("grok", "Grok"),
    ("pi", "Pi"),
    ("commandcode", "Command Code"),
    ("kimi", "Kimi"),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillBackendTarget {
    pub id: String,
    pub label: String,
    pub dir: String,
    /// Whether the directory already exists (it is created on first install).
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JeanSkill {
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
    /// Backend ids that currently have this skill installed.
    pub backends: Vec<String>,
    /// Path to one installed copy, used as the source when editing.
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JeanSkillDocument {
    pub slug: String,
    pub name: String,
    pub description: Option<String>,
    pub content: String,
    pub backends: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSkillResult {
    pub slug: String,
    pub name: String,
    /// Backend ids the skill was written to.
    pub installed: Vec<String>,
    /// Backends that could not be written, with the reason.
    pub failed: Vec<SkillFailure>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillFailure {
    pub backend: String,
    pub error: String,
}

fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "No home directory found".to_string())
}

fn opencode_config_dir(home: &Path) -> PathBuf {
    if let Ok(xdg_config_home) = std::env::var("XDG_CONFIG_HOME") {
        return PathBuf::from(xdg_config_home).join("opencode");
    }

    #[cfg(windows)]
    {
        if let Ok(app_data) = std::env::var("APPDATA") {
            return PathBuf::from(app_data).join("opencode");
        }
        home.join("AppData").join("Roaming").join("opencode")
    }

    #[cfg(not(windows))]
    {
        home.join(".config").join("opencode")
    }
}

/// Directory a backend's CLI reads user-global skills from.
fn backend_skills_dir(home: &Path, backend: &str) -> Option<PathBuf> {
    match backend {
        "claude" => Some(home.join(".claude").join("skills")),
        // Codex reads both ~/.agents/skills and ~/.codex/skills; .agents is the
        // current location, so new installs go there.
        "codex" => Some(home.join(".agents").join("skills")),
        "opencode" => Some(opencode_config_dir(home).join("skills")),
        "cursor" => Some(home.join(".cursor").join("skills-cursor")),
        "grok" => Some(home.join(".grok").join("skills")),
        // These CLIs have no user-global skill root of their own; Jean mirrors
        // them under ~/.jean/skills/<backend> and reads back from there.
        "pi" | "commandcode" | "kimi" => Some(home.join(".jean").join("skills").join(backend)),
        _ => None,
    }
}

pub fn slugify_skill_name(name: &str) -> String {
    let lowered: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();

    let mut slug = String::with_capacity(lowered.len());
    let mut previous_dash = false;
    for c in lowered.chars() {
        if c == '-' {
            if !previous_dash && !slug.is_empty() {
                slug.push('-');
            }
            previous_dash = true;
        } else {
            slug.push(c);
            previous_dash = false;
        }
    }
    slug.trim_matches('-').to_string()
}

/// Reject anything that could escape the skills directory.
fn validate_slug(slug: &str) -> Result<(), String> {
    if slug.is_empty() {
        return Err("Skill name has no usable characters".to_string());
    }
    if !slug
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(format!("Invalid skill id: {slug}"));
    }
    Ok(())
}

#[derive(Debug, Default)]
struct SkillFrontmatter {
    name: Option<String>,
    description: Option<String>,
}

fn parse_frontmatter(content: &str) -> (SkillFrontmatter, Option<serde_yaml::Mapping>) {
    let (raw, _) = split_frontmatter(content);
    let Some(raw) = raw else {
        return (SkillFrontmatter::default(), None);
    };

    let mapping = match serde_yaml::from_str::<serde_yaml::Mapping>(raw) {
        Ok(mapping) => mapping,
        Err(error) => {
            log::warn!("Failed to parse skill frontmatter: {error}");
            return (SkillFrontmatter::default(), None);
        }
    };

    let read = |key: &str| {
        mapping
            .get(serde_yaml::Value::String(key.to_string()))
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    };

    (
        SkillFrontmatter {
            name: read("name"),
            description: read("description"),
        },
        Some(mapping),
    )
}

/// Rebuild a `SKILL.md` with `name` / `description` guaranteed present,
/// preserving any other frontmatter keys the paste carried.
fn render_skill_file(name: &str, description: Option<&str>, content: &str) -> String {
    let (_, existing_mapping) = parse_frontmatter(content);
    let (_, body) = split_frontmatter(content);

    let mut mapping = existing_mapping.unwrap_or_default();
    mapping.insert(
        serde_yaml::Value::String("name".to_string()),
        serde_yaml::Value::String(name.to_string()),
    );
    match description.map(str::trim).filter(|value| !value.is_empty()) {
        Some(description) => {
            mapping.insert(
                serde_yaml::Value::String("description".to_string()),
                serde_yaml::Value::String(description.to_string()),
            );
        }
        None => {
            mapping.remove(serde_yaml::Value::String("description".to_string()));
        }
    }

    let yaml = serde_yaml::to_string(&mapping).unwrap_or_else(|_| format!("name: {name}\n"));
    let body = body.trim_start_matches('\n');

    let mut out = String::with_capacity(yaml.len() + body.len() + 16);
    out.push_str("---\n");
    out.push_str(&yaml);
    if !yaml.ends_with('\n') {
        out.push('\n');
    }
    out.push_str("---\n\n");
    out.push_str(body);
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out
}

fn resolve_backends(requested: Option<Vec<String>>) -> Result<Vec<String>, String> {
    let Some(requested) = requested else {
        return Ok(SKILL_BACKENDS
            .iter()
            .map(|(id, _)| (*id).to_string())
            .collect());
    };

    if requested.is_empty() {
        return Err("Select at least one agent".to_string());
    }

    for backend in &requested {
        if !SKILL_BACKENDS.iter().any(|(id, _)| id == backend) {
            return Err(format!("Unknown backend: {backend}"));
        }
    }
    Ok(requested)
}

pub async fn list_skill_backends() -> Result<Vec<SkillBackendTarget>, String> {
    let home = home_dir()?;

    Ok(SKILL_BACKENDS
        .iter()
        .filter_map(|(id, label)| {
            let dir = backend_skills_dir(&home, id)?;
            Some(SkillBackendTarget {
                id: (*id).to_string(),
                label: (*label).to_string(),
                exists: dir.is_dir(),
                dir: dir.to_string_lossy().to_string(),
            })
        })
        .collect())
}

/// List every skill installed in at least one backend directory, keyed by slug.
pub async fn list_jean_skills() -> Result<Vec<JeanSkill>, String> {
    let home = home_dir()?;
    let mut skills: BTreeMap<String, JeanSkill> = BTreeMap::new();

    for (backend, _) in SKILL_BACKENDS {
        let Some(dir) = backend_skills_dir(&home, backend) else {
            continue;
        };
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let skill_file = path.join(SKILL_FILE);
            if !skill_file.is_file() {
                continue;
            }
            let Some(slug) = path.file_name().and_then(|s| s.to_str()) else {
                continue;
            };

            let contents = std::fs::read_to_string(&skill_file).unwrap_or_default();
            let (frontmatter, _) = parse_frontmatter(&contents);

            let skill = skills.entry(slug.to_string()).or_insert_with(|| JeanSkill {
                slug: slug.to_string(),
                name: frontmatter.name.clone().unwrap_or_else(|| slug.to_string()),
                description: frontmatter.description.clone(),
                backends: Vec::new(),
                path: Some(skill_file.to_string_lossy().to_string()),
            });
            skill.backends.push((*backend).to_string());
        }
    }

    Ok(skills.into_values().collect())
}

pub async fn read_jean_skill(slug: String) -> Result<JeanSkillDocument, String> {
    validate_slug(&slug)?;
    let home = home_dir()?;

    let mut backends = Vec::new();
    let mut found: Option<(String, SkillFrontmatter)> = None;

    for (backend, _) in SKILL_BACKENDS {
        let Some(dir) = backend_skills_dir(&home, backend) else {
            continue;
        };
        let skill_file = dir.join(&slug).join(SKILL_FILE);
        if !skill_file.is_file() {
            continue;
        }
        backends.push((*backend).to_string());

        if found.is_none() {
            let contents = std::fs::read_to_string(&skill_file)
                .map_err(|e| format!("Failed to read {}: {e}", skill_file.display()))?;
            let (frontmatter, _) = parse_frontmatter(&contents);
            found = Some((contents, frontmatter));
        }
    }

    let (content, frontmatter) = found.ok_or_else(|| format!("Skill not found: {slug}"))?;

    Ok(JeanSkillDocument {
        name: frontmatter.name.unwrap_or_else(|| slug.clone()),
        description: frontmatter.description,
        slug,
        content,
        backends,
    })
}

/// Write a skill into every selected backend directory.
///
/// `name` / `description` override whatever the pasted frontmatter carried;
/// when both are absent the frontmatter must supply a name.
pub async fn save_jean_skill(
    content: String,
    name: Option<String>,
    description: Option<String>,
    backends: Option<Vec<String>>,
    previous_slug: Option<String>,
) -> Result<SaveSkillResult, String> {
    if content.trim().is_empty() {
        return Err("Skill content cannot be empty".to_string());
    }

    let (frontmatter, _) = parse_frontmatter(&content);
    let name = name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or(frontmatter.name)
        .ok_or_else(|| {
            "Give the skill a name, or include `name:` in its frontmatter".to_string()
        })?;
    let description = description
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or(frontmatter.description);

    let slug = slugify_skill_name(&name);
    validate_slug(&slug)?;

    let targets = resolve_backends(backends)?;
    let rendered = render_skill_file(&name, description.as_deref(), &content);
    let home = home_dir()?;

    let mut installed = Vec::new();
    let mut failed = Vec::new();

    for backend in &targets {
        let Some(dir) = backend_skills_dir(&home, backend) else {
            continue;
        };
        match write_skill(&dir.join(&slug), &rendered) {
            Ok(()) => installed.push(backend.clone()),
            Err(error) => failed.push(SkillFailure {
                backend: backend.clone(),
                error,
            }),
        }
    }

    // A rename leaves the old directory behind in every backend.
    if let Some(previous) = previous_slug
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && *value != slug)
    {
        validate_slug(&previous)?;
        remove_skill_everywhere(&home, &previous, None);
    }

    if installed.is_empty() {
        let reason = failed
            .first()
            .map(|failure| failure.error.clone())
            .unwrap_or_else(|| "No writable agent directories".to_string());
        return Err(reason);
    }

    Ok(SaveSkillResult {
        slug,
        name,
        installed,
        failed,
    })
}

fn write_skill(skill_dir: &Path, contents: &str) -> Result<(), String> {
    std::fs::create_dir_all(skill_dir)
        .map_err(|e| format!("Failed to create {}: {e}", skill_dir.display()))?;

    let path = skill_dir.join(SKILL_FILE);
    let temp_path = skill_dir.join(format!("{SKILL_FILE}.tmp"));
    std::fs::write(&temp_path, contents)
        .map_err(|e| format!("Failed to write {}: {e}", temp_path.display()))?;
    std::fs::rename(&temp_path, &path)
        .map_err(|e| format!("Failed to finalize {}: {e}", path.display()))
}

fn remove_skill_everywhere(home: &Path, slug: &str, only: Option<&[String]>) -> Vec<String> {
    let mut removed = Vec::new();

    for (backend, _) in SKILL_BACKENDS {
        if let Some(only) = only {
            if !only.iter().any(|id| id == backend) {
                continue;
            }
        }
        let Some(dir) = backend_skills_dir(home, backend) else {
            continue;
        };
        let skill_dir = dir.join(slug);
        if !skill_dir.join(SKILL_FILE).is_file() {
            continue;
        }
        match std::fs::remove_dir_all(&skill_dir) {
            Ok(()) => removed.push((*backend).to_string()),
            Err(error) => log::warn!("Failed to remove {}: {error}", skill_dir.display()),
        }
    }

    removed
}

pub async fn delete_jean_skill(
    slug: String,
    backends: Option<Vec<String>>,
) -> Result<Vec<String>, String> {
    validate_slug(&slug)?;
    let targets = backends
        .map(|value| resolve_backends(Some(value)))
        .transpose()?;
    let home = home_dir()?;
    Ok(remove_skill_everywhere(&home, &slug, targets.as_deref()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_handles_punctuation_and_spacing() {
        assert_eq!(slugify_skill_name("  Wait, What?! "), "wait-what");
        assert_eq!(slugify_skill_name("Gen Z"), "gen-z");
        assert_eq!(slugify_skill_name("***"), "");
    }

    #[test]
    fn validate_slug_rejects_traversal() {
        assert!(validate_slug("..").is_err());
        assert!(validate_slug("a/b").is_err());
        assert!(validate_slug("").is_err());
        assert!(validate_slug("my-skill-2").is_ok());
    }

    #[test]
    fn parse_frontmatter_reads_name_and_description() {
        let (frontmatter, mapping) = parse_frontmatter(
            "---\nname: architect\ndescription: \"Sketch types\"\ndisable-model-invocation: true\n---\n\n# Architect\n",
        );
        assert_eq!(frontmatter.name.as_deref(), Some("architect"));
        assert_eq!(frontmatter.description.as_deref(), Some("Sketch types"));
        assert!(mapping.is_some());
    }

    #[test]
    fn parse_frontmatter_tolerates_missing_and_broken_yaml() {
        let (none, _) = parse_frontmatter("# Just a heading\n");
        assert!(none.name.is_none());
        let (broken, mapping) = parse_frontmatter("---\nname: [unclosed\n---\nbody");
        assert!(broken.name.is_none());
        assert!(mapping.is_none());
    }

    #[test]
    fn render_injects_frontmatter_into_a_bare_paste() {
        let rendered = render_skill_file("My Skill", Some("does things"), "Be brief.\n");
        let (frontmatter, _) = parse_frontmatter(&rendered);
        assert_eq!(frontmatter.name.as_deref(), Some("My Skill"));
        assert_eq!(frontmatter.description.as_deref(), Some("does things"));
        assert!(rendered.ends_with("Be brief.\n"));
    }

    #[test]
    fn render_preserves_other_frontmatter_keys() {
        let rendered = render_skill_file(
            "Architect",
            None,
            "---\nname: old\ndisable-model-invocation: true\n---\n\nBody\n",
        );
        assert!(rendered.contains("disable-model-invocation: true"));
        assert!(rendered.contains("name: Architect"));
        assert!(!rendered.contains("name: old"));
    }

    #[test]
    fn render_drops_description_when_cleared() {
        let rendered = render_skill_file(
            "Architect",
            None,
            "---\nname: a\ndescription: gone\n---\n\nBody\n",
        );
        assert!(!rendered.contains("description:"));
    }

    #[test]
    fn resolve_backends_defaults_to_every_target() {
        assert_eq!(resolve_backends(None).unwrap().len(), SKILL_BACKENDS.len());
        assert!(resolve_backends(Some(vec![])).is_err());
        assert!(resolve_backends(Some(vec!["nope".to_string()])).is_err());
        assert_eq!(
            resolve_backends(Some(vec!["claude".to_string()])).unwrap(),
            vec!["claude".to_string()]
        );
    }

    #[test]
    fn backend_dirs_cover_every_listed_backend() {
        let home = Path::new("/home/test");
        for (id, _) in SKILL_BACKENDS {
            assert!(
                backend_skills_dir(home, id).is_some(),
                "missing skills dir for {id}"
            );
        }
        assert!(backend_skills_dir(home, "unknown").is_none());
    }

    #[test]
    fn write_and_remove_round_trip() {
        let temp = tempfile::tempdir().unwrap();
        let skill_dir = temp.path().join("claude-skills").join("my-skill");
        write_skill(&skill_dir, "---\nname: My Skill\n---\n\nBody\n").unwrap();

        let written = std::fs::read_to_string(skill_dir.join(SKILL_FILE)).unwrap();
        assert!(written.contains("name: My Skill"));
        assert!(!skill_dir.join("SKILL.md.tmp").exists());

        std::fs::remove_dir_all(&skill_dir).unwrap();
        assert!(!skill_dir.exists());
    }
}
