//! Claude Code output styles.
//!
//! An output style sets Claude's role, tone, and response format for a whole
//! session. The CLI reads the active style from the `outputStyle` settings key
//! and discovers custom styles from `~/.claude/output-styles/` (user) and
//! `<cwd>/.claude/output-styles/` (project, nearest-wins up to the repo root).
//!
//! Jean cannot use the CLI's `/output-style` command because it drives the CLI
//! non-interactively, so discovery, authoring, and selection all live here.
//! Reference: <https://code.claude.com/docs/en/output-styles>

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::projects::split_frontmatter;

/// Sentinel for "no output style" — matches the name the CLI shows for unset.
pub const DEFAULT_OUTPUT_STYLE: &str = "Default";

const STYLES_DIR: &str = "output-styles";

/// Built-in styles the CLI ships. Names are case-sensitive.
const BUILT_IN_STYLES: &[(&str, &str, Option<&str>)] = &[
    (
        "Proactive",
        "Starts work right away and makes reasonable assumptions instead of asking about routine decisions",
        None,
    ),
    (
        "Concise",
        "Leads with the result and leaves out preamble, narration, and recaps",
        Some("2.1.237"),
    ),
    (
        "Explanatory",
        "Adds short Insight blocks explaining the choices behind the code",
        None,
    ),
    (
        "Learning",
        "Explains its choices and leaves small pieces of code for you to write",
        None,
    ),
];

/// Styles vendored from https://github.com/smixs/awesome-claude-output-styles (MIT).
/// Tuple is (slug, category, embedded file contents).
const BUNDLED_STYLES: &[(&str, &str, &str)] = &[
    (
        "wait-what",
        "Understand",
        include_str!("../../assets/output-styles/wait-what.md"),
    ),
    (
        "plain-english",
        "Understand",
        include_str!("../../assets/output-styles/plain-english.md"),
    ),
    (
        "eli15",
        "Understand",
        include_str!("../../assets/output-styles/eli15.md"),
    ),
    (
        "analogy-engine",
        "Understand",
        include_str!("../../assets/output-styles/analogy-engine.md"),
    ),
    (
        "feynman",
        "Understand",
        include_str!("../../assets/output-styles/feynman.md"),
    ),
    (
        "thing-explainer",
        "Understand",
        include_str!("../../assets/output-styles/thing-explainer.md"),
    ),
    (
        "ladder",
        "Understand",
        include_str!("../../assets/output-styles/ladder.md"),
    ),
    (
        "executive",
        "Business",
        include_str!("../../assets/output-styles/executive.md"),
    ),
    (
        "smart-brevity",
        "Business",
        include_str!("../../assets/output-styles/smart-brevity.md"),
    ),
    (
        "coach",
        "Business",
        include_str!("../../assets/output-styles/coach.md"),
    ),
    (
        "caveman",
        "Terse",
        include_str!("../../assets/output-styles/caveman.md"),
    ),
    (
        "adhd",
        "Terse",
        include_str!("../../assets/output-styles/adhd.md"),
    ),
    (
        "no-slop",
        "Terse",
        include_str!("../../assets/output-styles/no-slop.md"),
    ),
    (
        "no-ai-slop",
        "Terse",
        include_str!("../../assets/output-styles/no-ai-slop.md"),
    ),
    (
        "unslop",
        "Terse",
        include_str!("../../assets/output-styles/unslop.md"),
    ),
    (
        "street",
        "Fun",
        include_str!("../../assets/output-styles/street.md"),
    ),
    (
        "gen-z",
        "Fun",
        include_str!("../../assets/output-styles/gen-z.md"),
    ),
    (
        "sportscaster",
        "Fun",
        include_str!("../../assets/output-styles/sportscaster.md"),
    ),
    (
        "yoda",
        "Fun",
        include_str!("../../assets/output-styles/yoda.md"),
    ),
    (
        "bedtime-story",
        "Fun",
        include_str!("../../assets/output-styles/bedtime-story.md"),
    ),
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeOutputStyle {
    /// Name the CLI matches against `outputStyle` (case-sensitive).
    pub name: String,
    pub description: Option<String>,
    /// `built-in` | `bundled` | `user` | `project`
    pub source: String,
    /// Grouping label for bundled styles.
    pub category: Option<String>,
    /// Absolute path on disk. `None` for built-ins and uninstalled bundles.
    pub path: Option<String>,
    /// Slug used by `install_claude_output_style`. Bundled styles only.
    pub slug: Option<String>,
    /// Whether a bundled style has been written to disk yet.
    pub installed: bool,
    pub keep_coding_instructions: Option<bool>,
    pub force_for_plugin: Option<bool>,
    /// Minimum Claude CLI version required, when the style is version-gated.
    pub min_cli_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputStyleDocument {
    pub name: String,
    pub description: Option<String>,
    pub keep_coding_instructions: Option<bool>,
    pub body: String,
    pub path: String,
}

#[derive(Debug, Deserialize, Default)]
struct OutputStyleFrontmatter {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default, rename = "keep-coding-instructions")]
    keep_coding_instructions: Option<bool>,
    #[serde(default, rename = "force-for-plugin")]
    force_for_plugin: Option<bool>,
}

fn file_stem_name(path: &Path) -> String {
    path.file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Parse a style file's contents. Falls back to the file stem when the
/// frontmatter is absent or unparseable, so a broken style still shows up.
fn parse_style(contents: &str, fallback_name: &str) -> (OutputStyleFrontmatter, String) {
    let (frontmatter_raw, body) = split_frontmatter(contents);
    let mut parsed = frontmatter_raw
        .and_then(
            |raw| match serde_yaml::from_str::<OutputStyleFrontmatter>(raw) {
                Ok(frontmatter) => Some(frontmatter),
                Err(error) => {
                    log::warn!("Failed to parse output style frontmatter: {error}");
                    None
                }
            },
        )
        .unwrap_or_default();

    if parsed
        .name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .is_none()
    {
        parsed.name = Some(fallback_name.to_string());
    }

    (parsed, body.to_string())
}

fn style_from_file(path: &Path, source: &str) -> Option<ClaudeOutputStyle> {
    let contents = std::fs::read_to_string(path)
        .map_err(|e| log::warn!("Failed to read output style {}: {e}", path.display()))
        .ok()?;
    let (frontmatter, _) = parse_style(&contents, &file_stem_name(path));
    let name = frontmatter.name?;
    if name.trim().is_empty() {
        return None;
    }

    Some(ClaudeOutputStyle {
        name,
        description: frontmatter.description,
        source: source.to_string(),
        category: None,
        path: Some(path.to_string_lossy().to_string()),
        slug: None,
        installed: true,
        keep_coding_instructions: frontmatter.keep_coding_instructions,
        force_for_plugin: frontmatter.force_for_plugin,
        min_cli_version: None,
    })
}

fn collect_styles_from_dir(dir: &Path, source: &str, out: &mut HashMap<String, ClaudeOutputStyle>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }
        if let Some(style) = style_from_file(&path, source) {
            out.insert(style.name.clone(), style);
        }
    }
}

fn user_styles_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".claude").join(STYLES_DIR))
}

fn project_styles_dir(worktree_path: &str) -> PathBuf {
    Path::new(worktree_path).join(".claude").join(STYLES_DIR)
}

/// Directories the CLI loads project styles from: every `.claude/output-styles`
/// between the worktree path and the repository root. Returned farthest-first so
/// that later inserts (nearer the worktree) win.
fn project_styles_dirs(worktree_path: &str) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let mut current = Some(Path::new(worktree_path));

    while let Some(dir) = current {
        dirs.push(dir.join(".claude").join(STYLES_DIR));
        // A git worktree has `.git` as a file, a main checkout as a directory.
        if dir.join(".git").exists() {
            break;
        }
        current = dir.parent();
    }

    dirs.reverse();
    dirs
}

fn built_in_styles() -> Vec<ClaudeOutputStyle> {
    BUILT_IN_STYLES
        .iter()
        .map(|(name, description, min_version)| ClaudeOutputStyle {
            name: (*name).to_string(),
            description: Some((*description).to_string()),
            source: "built-in".to_string(),
            category: None,
            path: None,
            slug: None,
            installed: true,
            keep_coding_instructions: Some(true),
            force_for_plugin: None,
            min_cli_version: min_version.map(ToString::to_string),
        })
        .collect()
}

fn bundled_style(slug: &str, category: &str, contents: &str) -> ClaudeOutputStyle {
    let (frontmatter, _) = parse_style(contents, slug);
    let installed_path = user_styles_dir()
        .map(|dir| dir.join(format!("{slug}.md")))
        .filter(|path| path.exists());

    ClaudeOutputStyle {
        name: frontmatter.name.unwrap_or_else(|| slug.to_string()),
        description: frontmatter.description,
        source: "bundled".to_string(),
        category: Some(category.to_string()),
        installed: installed_path.is_some(),
        path: installed_path.map(|path| path.to_string_lossy().to_string()),
        slug: Some(slug.to_string()),
        keep_coding_instructions: frontmatter.keep_coding_instructions,
        force_for_plugin: frontmatter.force_for_plugin,
        min_cli_version: None,
    }
}

fn bundled_styles() -> Vec<ClaudeOutputStyle> {
    BUNDLED_STYLES
        .iter()
        .map(|(slug, category, contents)| bundled_style(slug, category, contents))
        .collect()
}

fn bundled_contents(slug: &str) -> Option<&'static str> {
    BUNDLED_STYLES
        .iter()
        .find(|(candidate, _, _)| *candidate == slug)
        .map(|(_, _, contents)| *contents)
}

/// List every output style the CLI can resolve for this worktree.
///
/// Precedence matches the CLI: project styles (nearest wins) shadow user styles,
/// which shadow bundled presets. Built-ins are always present.
pub async fn list_claude_output_styles(
    worktree_path: Option<String>,
) -> Result<Vec<ClaudeOutputStyle>, String> {
    let mut styles: HashMap<String, ClaudeOutputStyle> = HashMap::new();

    for style in bundled_styles() {
        styles.insert(style.name.clone(), style);
    }

    if let Some(dir) = user_styles_dir() {
        collect_styles_from_dir(&dir, "user", &mut styles);
    }

    if let Some(worktree_path) = worktree_path.as_deref() {
        for dir in project_styles_dirs(worktree_path) {
            collect_styles_from_dir(&dir, "project", &mut styles);
        }
    }

    let mut result = built_in_styles();
    let mut discovered: Vec<ClaudeOutputStyle> = styles.into_values().collect();
    discovered.sort_by_key(|style| style.name.to_lowercase());
    result.extend(discovered);
    Ok(result)
}

pub async fn read_claude_output_style(path: String) -> Result<OutputStyleDocument, String> {
    let path = PathBuf::from(&path);
    let contents = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    let (frontmatter, body) = parse_style(&contents, &file_stem_name(&path));

    Ok(OutputStyleDocument {
        name: frontmatter.name.unwrap_or_default(),
        description: frontmatter.description,
        keep_coding_instructions: frontmatter.keep_coding_instructions,
        body,
        path: path.to_string_lossy().to_string(),
    })
}

fn slugify(name: &str) -> String {
    let slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();
    let mut collapsed = String::with_capacity(slug.len());
    let mut previous_dash = false;
    for c in slug.chars() {
        if c == '-' {
            if !previous_dash {
                collapsed.push(c);
            }
            previous_dash = true;
        } else {
            collapsed.push(c);
            previous_dash = false;
        }
    }
    collapsed.trim_matches('-').to_string()
}

fn target_dir(scope: &str, worktree_path: Option<&str>) -> Result<PathBuf, String> {
    match scope {
        "user" => user_styles_dir().ok_or_else(|| "No home directory found".to_string()),
        "project" => worktree_path
            .map(project_styles_dir)
            .ok_or_else(|| "A worktree path is required for project scope".to_string()),
        other => Err(format!("Unknown output style scope: {other}")),
    }
}

fn write_style_file(dir: &Path, slug: &str, contents: &str) -> Result<String, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create {}: {e}", dir.display()))?;
    let path = dir.join(format!("{slug}.md"));
    let temp_path = dir.join(format!("{slug}.md.tmp"));
    std::fs::write(&temp_path, contents)
        .map_err(|e| format!("Failed to write {}: {e}", temp_path.display()))?;
    std::fs::rename(&temp_path, &path)
        .map_err(|e| format!("Failed to finalize {}: {e}", path.display()))?;
    Ok(path.to_string_lossy().to_string())
}

fn render_style_file(
    name: &str,
    description: Option<&str>,
    keep_coding_instructions: Option<bool>,
    body: &str,
) -> String {
    let mut frontmatter = format!("---\nname: {name}\n");
    if let Some(description) = description.map(str::trim).filter(|s| !s.is_empty()) {
        frontmatter.push_str(&format!("description: {description}\n"));
    }
    if let Some(keep) = keep_coding_instructions {
        frontmatter.push_str(&format!("keep-coding-instructions: {keep}\n"));
    }
    frontmatter.push_str("---\n\n");
    frontmatter.push_str(body.trim_start_matches('\n'));
    if !frontmatter.ends_with('\n') {
        frontmatter.push('\n');
    }
    frontmatter
}

pub async fn save_claude_output_style(
    name: String,
    body: String,
    description: Option<String>,
    keep_coding_instructions: Option<bool>,
    scope: String,
    worktree_path: Option<String>,
) -> Result<String, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Output style name cannot be empty".to_string());
    }
    if name.eq_ignore_ascii_case(DEFAULT_OUTPUT_STYLE) {
        return Err(format!("'{DEFAULT_OUTPUT_STYLE}' is reserved"));
    }
    if BUILT_IN_STYLES
        .iter()
        .any(|(built_in, _, _)| built_in.eq_ignore_ascii_case(&name))
    {
        return Err(format!("'{name}' is a built-in output style name"));
    }

    let slug = slugify(&name);
    if slug.is_empty() {
        return Err("Output style name has no usable characters".to_string());
    }

    let dir = target_dir(&scope, worktree_path.as_deref())?;
    let contents = render_style_file(
        &name,
        description.as_deref(),
        keep_coding_instructions,
        &body,
    );
    write_style_file(&dir, &slug, &contents)
}

/// Write a bundled preset to disk so the CLI can discover it.
/// Refuses to clobber an existing file unless `overwrite` is set.
pub async fn install_claude_output_style(
    slug: String,
    scope: Option<String>,
    worktree_path: Option<String>,
    overwrite: Option<bool>,
) -> Result<String, String> {
    let contents =
        bundled_contents(&slug).ok_or_else(|| format!("Unknown bundled output style: {slug}"))?;
    let dir = target_dir(scope.as_deref().unwrap_or("user"), worktree_path.as_deref())?;
    let path = dir.join(format!("{slug}.md"));
    if path.exists() && !overwrite.unwrap_or(false) {
        return Err(format!("{} already exists", path.display()));
    }
    write_style_file(&dir, &slug, contents)
}

/// Guard against deleting arbitrary files: the path must sit inside a known
/// output-styles directory.
fn is_managed_style_path(path: &Path, worktree_path: Option<&str>) -> bool {
    let canonical = path.canonicalize().ok();
    let candidate = canonical.as_deref().unwrap_or(path);

    let mut allowed: Vec<PathBuf> = Vec::new();
    if let Some(dir) = user_styles_dir() {
        allowed.push(dir);
    }
    if let Some(worktree_path) = worktree_path {
        allowed.extend(project_styles_dirs(worktree_path));
    }

    allowed.iter().any(|dir| {
        let dir = dir.canonicalize().unwrap_or_else(|_| dir.clone());
        candidate.starts_with(&dir)
    })
}

pub async fn delete_claude_output_style(
    path: String,
    worktree_path: Option<String>,
) -> Result<(), String> {
    let path = PathBuf::from(&path);
    if !is_managed_style_path(&path, worktree_path.as_deref()) {
        return Err(format!(
            "Refusing to delete {} — not inside an output-styles directory",
            path.display()
        ));
    }
    std::fs::remove_file(&path).map_err(|e| format!("Failed to delete {}: {e}", path.display()))
}

/// Compare dotted version strings. Missing components count as zero.
pub fn version_at_least(version: &str, minimum: &str) -> bool {
    fn parts(value: &str) -> Vec<u64> {
        value
            .trim()
            .trim_start_matches('v')
            .split(['-', '+'])
            .next()
            .unwrap_or("")
            .split('.')
            .map(|part| part.parse::<u64>().unwrap_or(0))
            .collect()
    }

    let actual = parts(version);
    let required = parts(minimum);
    for index in 0..required.len().max(actual.len()) {
        let a = actual.get(index).copied().unwrap_or(0);
        let b = required.get(index).copied().unwrap_or(0);
        if a != b {
            return a > b;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_styles_all_parse() {
        let styles = bundled_styles();
        assert_eq!(styles.len(), BUNDLED_STYLES.len());
        for style in styles {
            assert!(!style.name.trim().is_empty(), "missing name: {style:?}");
            assert_eq!(
                style.keep_coding_instructions,
                Some(true),
                "bundled styles keep coding instructions: {style:?}"
            );
            assert!(style.slug.is_some());
            assert!(style.category.is_some());
        }
    }

    #[test]
    fn parse_prefers_frontmatter_name_over_filename() {
        let (frontmatter, body) = parse_style(
            "---\nname: Wait What\ndescription: ctx first\n---\n\nbody text\n",
            "wait-what",
        );
        assert_eq!(frontmatter.name.as_deref(), Some("Wait What"));
        assert_eq!(frontmatter.description.as_deref(), Some("ctx first"));
        assert_eq!(body.trim(), "body text");
    }

    #[test]
    fn parse_falls_back_to_file_stem() {
        let (frontmatter, _) = parse_style("no frontmatter here\n", "eli15");
        assert_eq!(frontmatter.name.as_deref(), Some("eli15"));
    }

    #[test]
    fn parse_reads_hyphenated_keys() {
        let (frontmatter, _) = parse_style(
            "---\nname: X\nkeep-coding-instructions: true\nforce-for-plugin: true\n---\nbody",
            "x",
        );
        assert_eq!(frontmatter.keep_coding_instructions, Some(true));
        assert_eq!(frontmatter.force_for_plugin, Some(true));
    }

    #[test]
    fn parse_tolerates_malformed_yaml() {
        let (frontmatter, body) = parse_style("---\nname: [unclosed\n---\nbody\n", "fallback");
        assert_eq!(frontmatter.name.as_deref(), Some("fallback"));
        assert_eq!(body.trim(), "body");
    }

    #[test]
    fn parse_tolerates_unterminated_frontmatter() {
        let (frontmatter, _) = parse_style("---\nname: X\nbody without close", "stem");
        assert_eq!(frontmatter.name.as_deref(), Some("stem"));
    }

    #[test]
    fn slugify_collapses_separators() {
        assert_eq!(slugify("Wait, What?!"), "wait-what");
        assert_eq!(slugify("  Gen Z  "), "gen-z");
        assert_eq!(slugify("***"), "");
    }

    #[test]
    fn render_round_trips_through_parse() {
        let rendered = render_style_file("My Style", Some("does things"), Some(true), "Be brief.");
        let (frontmatter, body) = parse_style(&rendered, "fallback");
        assert_eq!(frontmatter.name.as_deref(), Some("My Style"));
        assert_eq!(frontmatter.description.as_deref(), Some("does things"));
        assert_eq!(frontmatter.keep_coding_instructions, Some(true));
        assert_eq!(body.trim(), "Be brief.");
    }

    #[test]
    fn project_dirs_stop_at_repo_root_and_are_nearest_last() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("repo");
        let nested = root.join("packages").join("app");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(root.join(".git"), "gitdir: elsewhere").unwrap();

        let dirs = project_styles_dirs(&nested.to_string_lossy());
        assert_eq!(dirs.len(), 3);
        assert_eq!(
            dirs.first().unwrap(),
            &root.join(".claude").join(STYLES_DIR)
        );
        assert_eq!(
            dirs.last().unwrap(),
            &nested.join(".claude").join(STYLES_DIR)
        );
    }

    #[test]
    fn nearest_project_style_wins() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("repo");
        let nested = root.join("app");
        std::fs::create_dir_all(nested.join(".claude").join(STYLES_DIR)).unwrap();
        std::fs::create_dir_all(root.join(".claude").join(STYLES_DIR)).unwrap();
        std::fs::write(root.join(".git"), "gitdir: elsewhere").unwrap();
        std::fs::write(
            root.join(".claude").join(STYLES_DIR).join("shared.md"),
            "---\nname: Shared\ndescription: far\n---\nbody",
        )
        .unwrap();
        std::fs::write(
            nested.join(".claude").join(STYLES_DIR).join("shared.md"),
            "---\nname: Shared\ndescription: near\n---\nbody",
        )
        .unwrap();

        let mut styles = HashMap::new();
        for dir in project_styles_dirs(&nested.to_string_lossy()) {
            collect_styles_from_dir(&dir, "project", &mut styles);
        }
        assert_eq!(
            styles.get("Shared").unwrap().description.as_deref(),
            Some("near")
        );
    }

    #[test]
    fn delete_rejects_paths_outside_style_dirs() {
        let temp = tempfile::tempdir().unwrap();
        let stray = temp.path().join("stray.md");
        std::fs::write(&stray, "x").unwrap();
        assert!(!is_managed_style_path(&stray, None));
    }

    #[test]
    fn version_comparison() {
        assert!(!version_at_least("2.1.186", "2.1.237"));
        assert!(version_at_least("2.1.237", "2.1.237"));
        assert!(version_at_least("2.2.0", "2.1.237"));
        assert!(version_at_least("3.0", "2.1.237"));
        assert!(!version_at_least("", "2.1.237"));
    }
}
