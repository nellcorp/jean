import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JeanSkill, SkillBackendTarget } from '@/types/jean-skills'
import { SettingsTargetProvider } from '@/lib/settings-target'
import { SkillsPane } from './SkillsPane'

const saveMutate = vi.fn()
const deleteMutate = vi.fn()
const invokeMock = vi.fn()

let mockSkills: JeanSkill[] = []

const backends: SkillBackendTarget[] = [
  {
    id: 'claude',
    label: 'Claude',
    dir: '/home/u/.claude/skills',
    exists: true,
  },
  { id: 'codex', label: 'Codex', dir: '/home/u/.agents/skills', exists: true },
]

vi.mock('@/lib/transport', () => ({
  invokeForServer: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock('@/services/jean-skills', () => ({
  useJeanSkills: () => ({ data: mockSkills, isLoading: false }),
  useSkillBackends: () => ({ data: backends }),
  useSaveJeanSkill: () => ({ mutate: saveMutate, isPending: false }),
  useDeleteJeanSkill: () => ({ mutate: deleteMutate }),
}))

describe('SkillsPane', () => {
  beforeEach(() => {
    saveMutate.mockReset()
    deleteMutate.mockReset()
    invokeMock.mockReset()
    mockSkills = [
      {
        slug: 'architect',
        name: 'Architect',
        description: 'Sketch types first',
        backends: ['claude', 'codex'],
        path: '/home/u/.claude/skills/architect/SKILL.md',
      },
    ]
  })

  it('lists installed skills with the agents that have them', () => {
    render(<SkillsPane />)

    expect(screen.getByText('Architect')).toBeInTheDocument()
    expect(screen.getByText('Sketch types first')).toBeInTheDocument()
    expect(screen.getAllByText('Claude').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Codex').length).toBeGreaterThan(0)
  })

  it('installs a pasted skill into every agent by default', async () => {
    const user = userEvent.setup()
    render(<SkillsPane />)

    await user.click(screen.getByRole('button', { name: /add skill/i }))
    await user.type(
      screen.getByLabelText('SKILL.md'),
      '---{enter}name: Pasted{enter}---{enter}{enter}Body'
    )
    await user.click(screen.getByRole('button', { name: /^install$/i }))

    expect(saveMutate).toHaveBeenCalledTimes(1)
    const payload = saveMutate.mock.calls[0]?.[0]
    expect(payload.backends).toEqual(['claude', 'codex'])
    expect(payload.content).toContain('name: Pasted')
    expect(payload.previousSlug).toBeNull()
  })

  it('blocks installing when no agent is selected', async () => {
    const user = userEvent.setup()
    render(<SkillsPane />)

    await user.click(screen.getByRole('button', { name: /add skill/i }))
    await user.type(screen.getByLabelText('SKILL.md'), 'Body')
    await user.click(screen.getByRole('button', { name: /^none$/i }))

    expect(screen.getByRole('button', { name: /^install$/i })).toBeDisabled()
    expect(saveMutate).not.toHaveBeenCalled()
  })

  it('loads an existing skill into the editor for editing', async () => {
    invokeMock.mockResolvedValue({
      slug: 'architect',
      name: 'Architect',
      description: 'Sketch types first',
      content: '---\nname: Architect\n---\n\nBody\n',
      backends: ['claude'],
    })
    const user = userEvent.setup()
    render(<SkillsPane />)

    await user.click(screen.getByRole('button', { name: /edit architect/i }))

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('local', 'read_jean_skill', {
        slug: 'architect',
      })
    )
    await waitFor(() =>
      expect(screen.getByLabelText('SKILL.md')).toHaveValue(
        '---\nname: Architect\n---\n\nBody\n'
      )
    )
  })

  it('reads a skill from the selected remote settings server', async () => {
    invokeMock.mockResolvedValue({
      slug: 'architect',
      name: 'Architect',
      description: null,
      content: 'remote body',
      backends: ['claude'],
    })
    const user = userEvent.setup()
    render(
      <SettingsTargetProvider serverId="remote-one">
        <SkillsPane />
      </SettingsTargetProvider>
    )
    await user.click(screen.getByRole('button', { name: /edit architect/i }))
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('remote-one', 'read_jean_skill', {
        slug: 'architect',
      })
    )
    expect(await screen.findByLabelText('SKILL.md')).toHaveValue('remote body')
  })

  it('removes a skill from every agent', async () => {
    const user = userEvent.setup()
    render(<SkillsPane />)

    await user.click(screen.getByRole('button', { name: /remove architect/i }))

    expect(deleteMutate).toHaveBeenCalledWith(
      { slug: 'architect' },
      expect.anything()
    )
  })
})
