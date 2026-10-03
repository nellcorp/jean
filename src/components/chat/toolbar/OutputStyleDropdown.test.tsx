import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeOutputStyle } from '@/types/output-styles'
import { OutputStyleDropdown } from './OutputStyleDropdown'

const installMutate = vi.fn()
const listStyles = vi.fn()
const installStyleHook = vi.fn()

vi.mock('@/services/output-styles', () => ({
  useClaudeOutputStyles: (...args: unknown[]) => {
    listStyles(...args)
    return { data: mockStyles }
  },
  useInstallOutputStyle: (...args: unknown[]) => {
    installStyleHook(...args)
    return { mutate: installMutate }
  },
}))

let mockStyles: ClaudeOutputStyle[] = []

const style = (
  overrides: Partial<ClaudeOutputStyle> & { name: string }
): ClaudeOutputStyle => ({
  description: null,
  source: 'built-in',
  category: null,
  path: null,
  slug: null,
  installed: true,
  keepCodingInstructions: null,
  forceForPlugin: null,
  minCliVersion: null,
  ...overrides,
})

describe('OutputStyleDropdown', () => {
  beforeEach(() => {
    installMutate.mockReset()
    listStyles.mockClear()
    installStyleHook.mockClear()
    mockStyles = [
      style({ name: 'Explanatory' }),
      style({ name: 'Concise', minCliVersion: '2.1.237' }),
      style({ name: 'My Style', source: 'user', path: '/tmp/my-style.md' }),
      style({
        name: 'ELI15',
        source: 'bundled',
        category: 'Understand',
        slug: 'eli15',
        installed: false,
      }),
    ]
  })

  it('emits the style name and null for Default', async () => {
    const onOutputStyleChange = vi.fn()
    const user = userEvent.setup()
    render(
      <OutputStyleDropdown
        selectedOutputStyle={null}
        onOutputStyleChange={onOutputStyleChange}
      />
    )

    await user.click(screen.getByRole('button'))
    await user.click(
      await screen.findByRole('menuitemradio', { name: /My Style/ })
    )
    expect(onOutputStyleChange).toHaveBeenCalledWith('My Style')

    await user.click(screen.getByRole('button'))
    await user.click(
      await screen.findByRole('menuitemradio', { name: /Default/ })
    )
    expect(onOutputStyleChange).toHaveBeenLastCalledWith(null)
  })

  it('installs an uninstalled bundled style before selecting it', async () => {
    const onOutputStyleChange = vi.fn()
    installMutate.mockImplementation((_input, opts) => opts?.onSuccess?.())
    const user = userEvent.setup()
    render(
      <OutputStyleDropdown
        selectedOutputStyle={null}
        onOutputStyleChange={onOutputStyleChange}
      />
    )

    await user.click(screen.getByRole('button'))
    await user.click(
      await screen.findByRole('menuitemradio', { name: /ELI15/ })
    )

    expect(installMutate).toHaveBeenCalledWith(
      { slug: 'eli15' },
      expect.anything()
    )
    await waitFor(() =>
      expect(onOutputStyleChange).toHaveBeenCalledWith('ELI15')
    )
  })

  it('disables a style the installed CLI is too old for', async () => {
    const user = userEvent.setup()
    render(
      <OutputStyleDropdown
        selectedOutputStyle={null}
        cliVersion="2.1.186"
        onOutputStyleChange={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button'))
    const concise = await screen.findByRole('menuitemradio', {
      name: /Concise/,
    })
    expect(concise).toHaveAttribute('aria-disabled', 'true')
  })

  it('routes list and installation to the worktree owning server', () => {
    render(
      <OutputStyleDropdown
        selectedOutputStyle={null}
        worktreeId="remote-one:wt"
        worktreePath="/repo"
        onOutputStyleChange={vi.fn()}
      />
    )
    expect(listStyles).toHaveBeenCalledWith('/repo', 'remote-one')
    expect(installStyleHook).toHaveBeenCalledWith('remote-one')
  })
})
