import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

const invoke = vi.fn()
const routed = vi.fn()
const preferences = vi.fn()
const projects = vi.fn()
vi.mock('@/lib/transport', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  invokeForServer: (...args: unknown[]) => routed(...args),
}))
vi.mock('./preferences', () => ({
  usePreferences: (...args: unknown[]) => preferences(...args),
}))
vi.mock('./projects', () => ({
  isTauri: () => true,
  useProjects: () => projects(),
}))
import {
  loadLinearIssueContext,
  removeLinearIssueContext,
  useLinearTeams,
  useLoadedLinearIssueContexts,
} from './linear'
import { useOutlineCollections } from './outline'

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>
  )
}
beforeEach(() => {
  invoke.mockReset().mockResolvedValue([])
  routed.mockReset().mockResolvedValue([])
  projects.mockReset().mockReturnValue({ data: [] })
  preferences.mockReset().mockReturnValue({
    data: {
      linear_api_key_configured: true,
      outline_api_key_configured: true,
      outline_url: 'https://docs.example',
    },
  })
})
it('enables redacted Linear access using owning-server preferences', async () => {
  renderHook(() => useLinearTeams('remote:project'), { wrapper })
  await waitFor(() =>
    expect(routed).toHaveBeenCalledWith('remote', 'list_linear_teams', {
      projectId: 'project',
    })
  )
  expect(preferences).toHaveBeenCalledWith('remote')
  expect(invoke).not.toHaveBeenCalled()
})
it('enables redacted Outline access using owning-server preferences', async () => {
  renderHook(() => useOutlineCollections('remote:project'), { wrapper })
  await waitFor(() =>
    expect(routed).toHaveBeenCalledWith('remote', 'list_outline_collections', {
      projectId: 'project',
    })
  )
  expect(preferences).toHaveBeenCalledWith('remote')
})
it('strips scoped session, worktree and project IDs for loaded Linear contexts', async () => {
  renderHook(
    () =>
      useLoadedLinearIssueContexts(
        'remote:session',
        'remote:worktree',
        'remote:project'
      ),
    { wrapper }
  )
  await waitFor(() =>
    expect(routed).toHaveBeenCalledWith(
      'remote',
      'list_loaded_linear_issue_contexts',
      {
        sessionId: 'session',
        worktreeId: 'worktree',
        projectId: 'project',
      }
    )
  )
})
it('routes Linear context mutations with plain Jean IDs and unchanged issue identifiers', async () => {
  await loadLinearIssueContext('remote:session', 'remote:project', 'issue-id')
  await removeLinearIssueContext('remote:session', 'remote:project', 'TEAM-1')
  expect(routed).toHaveBeenCalledWith('remote', 'load_linear_issue_context', {
    sessionId: 'session',
    projectId: 'project',
    issueId: 'issue-id',
  })
  expect(routed).toHaveBeenCalledWith('remote', 'remove_linear_issue_context', {
    sessionId: 'session',
    projectId: 'project',
    identifier: 'TEAM-1',
  })
})
it('retains raw local invocation and per-project keys', async () => {
  preferences.mockReturnValue({ data: { outline_url: 'https://docs.example' } })
  projects.mockReturnValue({
    data: [
      { id: 'project', linear_api_key: 'linear', outline_api_key: 'outline' },
    ],
  })
  renderHook(() => useLinearTeams('project'), { wrapper })
  renderHook(() => useOutlineCollections('project'), { wrapper })
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('list_linear_teams', {
      projectId: 'project',
    })
  )
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('list_outline_collections', {
      projectId: 'project',
    })
  )
  expect(routed).not.toHaveBeenCalled()
})

it('does not infer local access from redacted remote-key flags', async () => {
  const linear = renderHook(() => useLinearTeams('project'), { wrapper })
  const outline = renderHook(() => useOutlineCollections('project'), {
    wrapper,
  })
  expect(linear.result.current.fetchStatus).toBe('idle')
  expect(outline.result.current.fetchStatus).toBe('idle')
  expect(invoke).not.toHaveBeenCalled()
})
it('requires an Outline URL even when the remote key is configured', () => {
  preferences.mockReturnValue({ data: { outline_api_key_configured: true } })
  const { result } = renderHook(() => useOutlineCollections('remote:project'), {
    wrapper,
  })
  expect(result.current.fetchStatus).toBe('idle')
  expect(routed).not.toHaveBeenCalled()
})
it('keeps raw local global credentials usable', async () => {
  preferences.mockReturnValue({
    data: {
      linear_api_key: 'local-linear',
      outline_api_key: 'local-outline',
      outline_url: 'https://docs.example',
    },
  })
  renderHook(() => useLinearTeams('project'), { wrapper })
  renderHook(() => useOutlineCollections('project'), { wrapper })
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('list_linear_teams', {
      projectId: 'project',
    })
  )
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith('list_outline_collections', {
      projectId: 'project',
    })
  )
})
it('separates identical project IDs on different servers in the query cache', async () => {
  const client = new QueryClient()
  function sharedWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  renderHook(() => useLinearTeams('first:project'), { wrapper: sharedWrapper })
  renderHook(() => useLinearTeams('second:project'), { wrapper: sharedWrapper })
  await waitFor(() => expect(routed).toHaveBeenCalledTimes(2))
  expect(routed).toHaveBeenCalledWith('first', 'list_linear_teams', {
    projectId: 'project',
  })
  expect(routed).toHaveBeenCalledWith('second', 'list_linear_teams', {
    projectId: 'project',
  })
})
