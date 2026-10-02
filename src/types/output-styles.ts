/**
 * Claude Code output styles.
 *
 * Mirrors `jean-core/src/claude_cli/output_styles.rs` (camelCase via serde).
 * See https://code.claude.com/docs/en/output-styles
 */

/** Sentinel for "no output style" — must match DEFAULT_OUTPUT_STYLE in Rust. */
export const DEFAULT_OUTPUT_STYLE = 'Default'

export type OutputStyleSource = 'built-in' | 'bundled' | 'user' | 'project'

export type OutputStyleScope = 'user' | 'project'

export interface ClaudeOutputStyle {
  /** Name the CLI matches against `outputStyle` (case-sensitive). */
  name: string
  description: string | null
  source: OutputStyleSource
  /** Grouping label for bundled styles. */
  category: string | null
  /** Absolute path on disk; null for built-ins and uninstalled bundles. */
  path: string | null
  /** Slug used by `install_claude_output_style`; bundled styles only. */
  slug: string | null
  installed: boolean
  keepCodingInstructions: boolean | null
  forceForPlugin: boolean | null
  /** Minimum Claude CLI version required, when version-gated. */
  minCliVersion: string | null
}

export interface OutputStyleDocument {
  name: string
  description: string | null
  keepCodingInstructions: boolean | null
  body: string
  path: string
}
