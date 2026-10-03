import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { IntegrationsPane } from './IntegrationsPane'

const { preferences, mutate } = vi.hoisted(() => ({
  preferences: vi.fn(),
  mutate: vi.fn(),
}))
vi.mock('@/services/preferences', () => ({
  usePreferences: () => preferences(),
  usePatchPreferences: () => ({ mutate, isPending: false }),
}))
vi.mock('@/services/sentry', () => ({ testSentryAuthToken: vi.fn() }))

beforeEach(() => {
  mutate.mockReset()
  preferences.mockReturnValue({
    data: {
      linear_api_key_configured: true,
      outline_api_key_configured: true,
      outline_url: 'https://docs.example.com',
    },
  })
})

it.each([
  ['Linear', 'pref-integrations-section-linear', { linear_api_key: null }],
  ['Outline', 'pref-integrations-section-outline', { outline_api_key: null }],
])(
  'allows removing a configured redacted %s secret',
  (_name, sectionId, patch) => {
    const { container } = render(<IntegrationsPane />)
    const section = container.querySelector(`#${sectionId}`)
    if (!(section instanceof HTMLElement))
      throw new Error(`Missing integration section ${sectionId}`)
    fireEvent.click(within(section).getByRole('button', { name: 'Remove' }))
    expect(mutate).toHaveBeenCalledWith(patch, expect.anything())
    expect(screen.getAllByDisplayValue('')).toHaveLength(3)
  }
)
