import { describe, expect, it } from 'vitest'
import { getClaudeSourceStatus } from './claude-cli-status'

const fallback = {
  installed: true,
  managed_installed: false,
  version: '2.0.0',
  path: '/usr/bin/claude',
  supports_auth_command: true,
}

describe('Claude settings source status', () => {
  it('hides execution fallback when the selected managed installation is missing', () => {
    expect(getClaudeSourceStatus(fallback, 'jean')).toEqual({
      installed: false,
      managed_installed: false,
      version: null,
      path: null,
      supports_auth_command: false,
    })
    expect(fallback.installed).toBe(true)
  })
  it('hides managed execution fallback when the selected PATH installation is missing', () => {
    const managed = { ...fallback, managed_installed: true }
    expect(getClaudeSourceStatus(managed, 'path', false)).toEqual({
      installed: false,
      managed_installed: true,
      version: null,
      path: null,
      supports_auth_command: false,
    })
    expect(managed.installed).toBe(true)
  })
  it('preserves PATH status and unknown managed status', () => {
    expect(getClaudeSourceStatus(fallback, 'path')).toBe(fallback)
    const managed = { ...fallback, managed_installed: true }
    expect(getClaudeSourceStatus(managed, 'jean')).toBe(managed)
    const unknown = { ...fallback, managed_installed: undefined }
    expect(getClaudeSourceStatus(unknown, 'jean')).toBe(unknown)
    expect(getClaudeSourceStatus(undefined, 'jean')).toBeUndefined()
  })
})
