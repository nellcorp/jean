import type { ClaudeCliStatus } from '@/types/claude-cli'

export function getClaudeSourceStatus(
  status: ClaudeCliStatus | undefined,
  source: 'jean' | 'path',
  pathFound?: boolean
): ClaudeCliStatus | undefined {
  if (!status) return status
  const sourceMissing =
    source === 'jean' ? status.managed_installed === false : pathFound === false
  if (!sourceMissing) return status
  return {
    ...status,
    installed: false,
    version: null,
    path: null,
    supports_auth_command: false,
  }
}
