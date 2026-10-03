import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeManagedInstallButton } from './ClaudeManagedInstallButton'
import { BackendCliSourceCards } from './BackendCliSourceCards'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  patch: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  reset: vi.fn(),
}))
vi.mock('@/lib/transport', () => ({ invoke: mocks.invoke }))
vi.mock('@/services/preferences', () => ({
  usePatchPreferences: () => ({ mutateAsync: mocks.patch }),
  preferencesQueryKeys: { preferences: () => ['preferences'] },
}))
vi.mock('@/services/claude-cli', () => ({
  useInstallProgress: () => [
    { message: 'Downloading Claude', percent: 40 },
    mocks.reset,
  ],
  claudeCliQueryKeys: {
    status: () => ['claude-cli', 'status'],
    auth: () => ['claude-cli', 'auth'],
  },
}))
vi.mock('sonner', () => ({
  toast: { success: mocks.success, error: mocks.error },
}))

function setup(managedInstalled: boolean | undefined) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const onValueChange = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <BackendCliSourceCards
        value="path"
        onValueChange={onValueChange}
        backendName="Claude CLI"
        path="/usr/bin/claude"
        pathFound
        managedAction={
          <ClaudeManagedInstallButton managedInstalled={managedInstalled} />
        }
      />
    </QueryClientProvider>
  )
  return { invalidate, onValueChange }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Claude managed install', () => {
  it.each([true, undefined])(
    'hides installation for managed status %s',
    managedInstalled => {
      setup(managedInstalled)
      expect(
        screen.queryByRole('button', { name: 'Install latest' })
      ).not.toBeInTheDocument()
    }
  )

  it('refreshes installed status when source switching fails', async () => {
    mocks.invoke.mockResolvedValue(undefined)
    mocks.patch.mockRejectedValue(new Error('Save failed'))
    const { invalidate } = setup(false)
    fireEvent.click(screen.getByRole('button', { name: 'Install latest' }))
    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        'Claude CLI installed, but failed to select Jean managed',
        { description: 'Save failed' }
      )
    )
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['claude-cli', 'status'],
    })
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it('installs latest independently of PATH selection and switches only after success', async () => {
    let complete: (() => void) | undefined
    mocks.invoke.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          complete = resolve
        })
    )
    mocks.patch.mockResolvedValue(undefined)
    const { invalidate, onValueChange } = setup(false)
    const button = screen.getByRole('button', { name: 'Install latest' })
    expect(button.closest('label')).toBeNull()
    fireEvent.click(button)
    fireEvent.click(button)
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('install_claude_cli', {
      version: null,
    })
    expect(mocks.patch).not.toHaveBeenCalled()
    expect(onValueChange).not.toHaveBeenCalled()
    expect(screen.getByText(/Downloading Claude/)).toBeInTheDocument()
    expect(button).toBeDisabled()
    complete?.()
    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith({ claude_cli_source: 'jean' })
    )
    await waitFor(() => expect(mocks.success).toHaveBeenCalled())
    for (const queryKey of [
      ['claude-cli', 'status'],
      ['claude-cli', 'auth'],
      ['preferences'],
    ]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey })
    }
    expect(mocks.reset).toHaveBeenCalledOnce()
  })

  it('retains the selected source and permits retry after installation failure', async () => {
    mocks.invoke.mockRejectedValue(new Error('Download failed'))
    const { onValueChange } = setup(false)
    fireEvent.click(screen.getByRole('button', { name: 'Install latest' }))
    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith('Failed to install Claude CLI', {
        description: 'Download failed',
      })
    )
    expect(mocks.patch).not.toHaveBeenCalled()
    expect(onValueChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Install latest' })).toBeEnabled()
  })
})
