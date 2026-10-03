import { test, expect } from '../fixtures/tauri-mock'

test.describe('App loads', () => {
  test('shows sidebar with project name', async ({ mockPage }) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })
  })

  test.describe('empty project', () => {
    test.use({ responseOverrides: { list_worktrees: [] } })

    test('shows dashboard empty state', async ({ mockPage }) => {
      await expect(
        mockPage.getByText('Your imagination is the only limit')
      ).toBeVisible({ timeout: 5000 })
    })
  })

  test('shows connected status', async ({ mockPage }) => {
    const connectionDot = mockPage.locator('.inline-block.size-2.bg-success')
    await expect(connectionDot).toBeVisible({ timeout: 5000 })
    await connectionDot.hover()
    await expect(
      mockPage.getByRole('tooltip', { name: 'Connected to server' })
    ).toBeVisible()
  })
})
