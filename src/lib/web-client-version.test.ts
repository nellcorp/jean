import { describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { CLIENT_WEB_BUILD_ID } from './build-info'
import { checkWebClientVersion } from './web-client-version'

vi.mock('@/lib/build-info', () => ({
  CLIENT_WEB_BUILD_ID: 'current-client-build',
  CLIENT_BUILD_INFO: { appVersion: '1.0.0' },
}))
vi.mock('@/lib/environment', () => ({ isNativeApp: () => false }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }))

describe('web client version checks', () => {
  it('detects a stale browser bundle without a reload nag', () => {
    expect(checkWebClientVersion({ webBuildId: 'new-server-build' })).toBe(true)
    expect(checkWebClientVersion({ webBuildId: 'new-server-build' })).toBe(true)
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('ignores matching or missing build IDs', () => {
    expect(checkWebClientVersion({ webBuildId: CLIENT_WEB_BUILD_ID })).toBe(
      false
    )
    expect(checkWebClientVersion({})).toBe(false)
    expect(toast.warning).not.toHaveBeenCalled()
  })
})
