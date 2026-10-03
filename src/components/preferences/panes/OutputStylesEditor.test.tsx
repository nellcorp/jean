import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SettingsTargetProvider } from '@/lib/settings-target'
import { OutputStylesEditor } from './OutputStylesEditor'

const invokeForServer = vi.hoisted(() => vi.fn())
vi.mock('@/lib/transport', () => ({ invokeForServer }))
vi.mock('@/services/output-styles', () => ({
  useClaudeOutputStyles: () => ({
    data: [{ name: 'Remote Style', source: 'user', path: '/styles/remote.md' }],
  }),
  useSaveOutputStyle: () => ({ mutate: vi.fn() }),
  useDeleteOutputStyle: () => ({ mutate: vi.fn() }),
  useInstallOutputStyle: () => ({ mutate: vi.fn() }),
}))

describe('OutputStylesEditor routing', () => {
  it('reads editable styles from the selected server', async () => {
    invokeForServer.mockResolvedValue({
      name: 'Remote Style',
      body: 'Server-specific instructions',
      description: null,
    })
    const user = userEvent.setup()
    render(
      <SettingsTargetProvider serverId="remote-one">
        <OutputStylesEditor />
      </SettingsTargetProvider>
    )
    await user.click(screen.getByRole('button', { name: 'Edit Remote Style' }))
    await waitFor(() =>
      expect(invokeForServer).toHaveBeenCalledWith(
        'remote-one',
        'read_claude_output_style',
        { path: '/styles/remote.md' }
      )
    )
    expect(
      await screen.findByDisplayValue('Server-specific instructions')
    ).toBeInTheDocument()
  })
})
