import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SettingsTargetProvider } from '@/lib/settings-target'
import { jeanSkillKeys, useJeanSkills, useSaveJeanSkill } from './jean-skills'
import {
  outputStyleQueryKeys,
  useClaudeOutputStyles,
  useInstallOutputStyle,
} from './output-styles'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), invokeForServer: vi.fn() }))
vi.mock('@/lib/transport', () => mocks)
vi.mock('@/services/projects', () => ({ isTauri: () => true }))

function wrapper(client: QueryClient, serverId: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <SettingsTargetProvider serverId={serverId}>
          {children}
        </SettingsTargetProvider>
      </QueryClientProvider>
    )
  }
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

describe('settings asset server routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.invoke.mockResolvedValue([])
    mocks.invokeForServer.mockImplementation(async serverId => [
      { name: serverId },
    ])
  })

  it('keeps skill lists from two settings servers isolated', async () => {
    const queryClient = client()
    const first = renderHook(() => useJeanSkills(), {
      wrapper: wrapper(queryClient, 'one'),
    })
    const second = renderHook(() => useJeanSkills(), {
      wrapper: wrapper(queryClient, 'two'),
    })
    await waitFor(() =>
      expect(first.result.current.data).toEqual([{ name: 'one' }])
    )
    await waitFor(() =>
      expect(second.result.current.data).toEqual([{ name: 'two' }])
    )
    expect(mocks.invokeForServer).toHaveBeenCalledWith(
      'one',
      'list_jean_skills'
    )
    expect(mocks.invokeForServer).toHaveBeenCalledWith(
      'two',
      'list_jean_skills'
    )
  })

  it('saves skills to the selected settings server', async () => {
    const hook = renderHook(() => useSaveJeanSkill(), {
      wrapper: wrapper(client(), 'one'),
    })
    await act(async () => {
      await hook.result.current.mutateAsync({ content: 'skill' })
    })
    expect(mocks.invokeForServer).toHaveBeenCalledWith(
      'one',
      'save_jean_skill',
      expect.objectContaining({ content: 'skill' })
    )
  })

  it('keeps output styles separate even when servers use identical paths', async () => {
    const queryClient = client()
    const first = renderHook(() => useClaudeOutputStyles('/repo'), {
      wrapper: wrapper(queryClient, 'one'),
    })
    const second = renderHook(() => useClaudeOutputStyles('/repo'), {
      wrapper: wrapper(queryClient, 'two'),
    })
    await waitFor(() =>
      expect(first.result.current.data).toEqual([{ name: 'one' }])
    )
    await waitFor(() =>
      expect(second.result.current.data).toEqual([{ name: 'two' }])
    )
  })

  it('uses the chat owning server rather than settings context when supplied', async () => {
    const hook = renderHook(
      () => useClaudeOutputStyles('/repo', 'chat-server'),
      { wrapper: wrapper(client(), 'settings-server') }
    )
    await waitFor(() =>
      expect(hook.result.current.data).toEqual([{ name: 'chat-server' }])
    )
    expect(mocks.invokeForServer).toHaveBeenCalledWith(
      'chat-server',
      'list_claude_output_styles',
      { worktreePath: '/repo' }
    )
  })

  it('installs a bundled chat style on its owning server', async () => {
    const hook = renderHook(() => useInstallOutputStyle('chat-server'), {
      wrapper: wrapper(client(), 'settings-server'),
    })
    await act(async () => {
      await hook.result.current.mutateAsync({ slug: 'terse' })
    })
    expect(mocks.invokeForServer).toHaveBeenCalledWith(
      'chat-server',
      'install_claude_output_style',
      expect.objectContaining({ slug: 'terse' })
    )
  })

  it('invalidates only the selected server output style caches', async () => {
    const queryClient = client()
    const one = outputStyleQueryKeys.list(null, 'one')
    const two = outputStyleQueryKeys.list(null, 'two')
    const local = outputStyleQueryKeys.list(null)
    for (const key of [one, two, local]) queryClient.setQueryData(key, [])
    const hook = renderHook(() => useInstallOutputStyle(), {
      wrapper: wrapper(queryClient, 'one'),
    })
    await act(async () => {
      await hook.result.current.mutateAsync({ slug: 'terse' })
    })
    expect(queryClient.getQueryState(one)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(two)?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(local)?.isInvalidated).toBe(false)
  })

  it('invalidates only selected server Jean skill caches', async () => {
    const queryClient = client()
    const one = jeanSkillKeys.list('one')
    const two = jeanSkillKeys.list('two')
    const local = jeanSkillKeys.list()
    for (const key of [one, two, local]) queryClient.setQueryData(key, [])
    const hook = renderHook(() => useSaveJeanSkill(), {
      wrapper: wrapper(queryClient, 'one'),
    })
    await act(async () => {
      await hook.result.current.mutateAsync({ content: 'skill' })
    })
    expect(queryClient.getQueryState(one)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(two)?.isInvalidated).toBe(false)
    expect(queryClient.getQueryState(local)?.isInvalidated).toBe(false)
  })

  it('preserves local keys while explicitly routing local settings', async () => {
    expect(jeanSkillKeys.list()).toEqual(['jean-skills', 'list'])
    expect(outputStyleQueryKeys.list('/repo')).toEqual([
      'claude-output-styles',
      'list',
      '/repo',
    ])
    const hook = renderHook(() => useJeanSkills(), {
      wrapper: wrapper(client(), 'local'),
    })
    await waitFor(() =>
      expect(hook.result.current.data).toEqual([{ name: 'local' }])
    )
    expect(mocks.invokeForServer).toHaveBeenCalledWith(
      'local',
      'list_jean_skills'
    )
  })
})
