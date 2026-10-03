import type { ReactNode } from 'react'
import type * as PlatformModule from '@/lib/platform'
import type * as TransportModule from '@/lib/transport'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.fn()
const nativeOpenAllowed = vi.fn()
const openExternal = vi.fn()
const invoke = vi.fn()
const preferences = vi.fn()

vi.mock('@/lib/environment', () => ({
  hasBackend: () => true,
  hasBackendTransport: () => true,
  isNativeApp: () => native(),
  canOpenNativeApps: () => nativeOpenAllowed(),
}))
vi.mock('@/lib/platform', async importOriginal => ({
  ...(await importOriginal<typeof PlatformModule>()),
  openExternal: (...args: unknown[]) => openExternal(...args),
}))
vi.mock('@/lib/transport', async importOriginal => ({
  ...(await importOriginal<typeof TransportModule>()),
  invoke: (...args: unknown[]) => invoke(...args),
}))
vi.mock('./preferences', () => ({ usePreferences: () => preferences() }))

import {
  buildWebEditorUrl,
  useOpenWorktreeInEditor,
  useWebEditorUrl,
} from './projects'

beforeEach(() => {
  native.mockReset().mockReturnValue(false)
  nativeOpenAllowed.mockReset().mockReturnValue(false)
  openExternal.mockReset().mockResolvedValue(undefined)
  invoke.mockReset().mockResolvedValue(undefined)
  preferences
    .mockReset()
    .mockReturnValue({ data: { web_editor_url: ' /code/ ' } })
})

describe('web editor', () => {
  it.each([
    [undefined, `${window.location.origin}/code`],
    [' /custom/ ', `${window.location.origin}/custom`],
    ['custom/', `${window.location.origin}/custom`],
    [' https://editor.example/code/// ', 'https://editor.example/code'],
  ])('resolves override %s and encodes the folder', (override, base) => {
    expect(buildWebEditorUrl('/home/user/my project', override)).toBe(
      `${base}/?folder=%2Fhome%2Fuser%2Fmy%20project`
    )
  })

  it('exposes configured browser URLs but hides unavailable and native targets', () => {
    const { result, rerender } = renderHook(() => useWebEditorUrl())
    expect(result.current).toBe('/code/')
    preferences.mockReturnValue({ data: { web_editor_url: '  ' } })
    rerender()
    expect(result.current).toBeNull()
    native.mockReturnValue(true)
    preferences.mockReturnValue({ data: { web_editor_url: '/code' } })
    rerender()
    expect(result.current).toBeNull()
  })

  it('opens the backend native editor in Web Access when no browser editor is configured', async () => {
    nativeOpenAllowed.mockReturnValue(true)
    const client = new QueryClient()
    client.setQueryData(['preferences'], { web_editor_url: null })
    function wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      )
    }
    const { result } = renderHook(() => useOpenWorktreeInEditor(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({
        worktreePath: '/worktree',
        editor: 'zed',
      })
    })
    expect(invoke).toHaveBeenCalledWith('open_worktree_in_editor', {
      worktreePath: '/worktree',
      editor: 'zed',
    })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('opens the configured browser editor without invoking a native editor', async () => {
    const client = new QueryClient()
    client.setQueryData(['preferences'], {
      web_editor_url: 'https://editor.example/code',
    })
    function wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      )
    }
    const { result } = renderHook(() => useOpenWorktreeInEditor(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({
        worktreePath: '/worktree',
        preOpenedWindow: null,
      })
    })
    expect(openExternal).toHaveBeenCalledWith(
      'https://editor.example/code/?folder=%2Fworktree',
      null
    )
    expect(invoke).not.toHaveBeenCalled()
  })
})
