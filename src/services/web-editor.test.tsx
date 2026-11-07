import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWebEditorUrl } from './web-editor'

const state = vi.hoisted(() => ({ native: false, url: null as string | null }))
vi.mock('@/lib/environment', () => ({ isNativeApp: () => state.native }))
vi.mock('./preferences', () => ({
  usePreferences: () => ({ data: { web_editor_url: state.url } }),
}))

const fetchMock = vi.fn()
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return { ...renderHook(() => useWebEditorUrl(), { wrapper }), client }
}

beforeEach(() => {
  state.native = false
  state.url = null
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('browser editor discovery', () => {
  it('restores the editor when its persisted preference is missing', async () => {
    fetchMock.mockResolvedValue(
      new Response('<meta id="vscode-workbench-web-configuration">')
    )
    const { result } = setup()
    await waitFor(() => expect(result.current).toBe('/code'))
    expect(fetchMock).toHaveBeenCalledWith('/code/', {
      signal: expect.any(AbortSignal),
    })
  })

  it.each([
    new Response('<html>Jean</html>'),
    new Response('<html>Login</html>'),
    new Response('Not found', { status: 404 }),
  ])(
    'hides the editor when the route does not serve VS Code',
    async response => {
      fetchMock.mockResolvedValue(response)
      const { result } = setup()
      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      expect(result.current).toBeNull()
    }
  )

  it('keeps the editor hidden when discovery fails', async () => {
    fetchMock.mockRejectedValue(new Error('Offline'))
    const { result, client } = setup()
    await waitFor(() =>
      expect(
        client.getQueryState(['bundled-web-editor', window.location.origin])
          ?.fetchStatus
      ).toBe('idle')
    )
    expect(result.current).toBeNull()
  })

  it('uses a configured URL without probing', () => {
    state.url = ' https://editor.example/code '
    const { result } = setup()
    expect(result.current).toBe('https://editor.example/code')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not probe or show a browser editor in the native app', () => {
    state.native = true
    const { result } = setup()
    expect(result.current).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
