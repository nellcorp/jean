/**
 * Cross-backend skill management.
 *
 * Mirrors `jean-core/src/skills/mod.rs` (camelCase via serde).
 */

export interface SkillBackendTarget {
  id: string
  label: string
  dir: string
  /** Whether the directory exists yet; it is created on first install. */
  exists: boolean
}

export interface JeanSkill {
  slug: string
  name: string
  description: string | null
  /** Backend ids that currently have this skill installed. */
  backends: string[]
  path: string | null
}

export interface JeanSkillDocument {
  slug: string
  name: string
  description: string | null
  content: string
  backends: string[]
}

export interface SkillFailure {
  backend: string
  error: string
}

export interface SaveSkillResult {
  slug: string
  name: string
  installed: string[]
  failed: SkillFailure[]
}
