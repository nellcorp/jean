import { test, expect } from '../fixtures/tauri-mock'

test.describe('Keyboard shortcuts', () => {
  test('Ctrl+K opens command palette', async ({ mockPage }) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })

    await mockPage.keyboard.press('Control+k')

    const input = mockPage.locator('[cmdk-input]')
    await expect(input).toBeVisible({ timeout: 3000 })
  })

  test('Ctrl+B toggles sidebar panel', async ({ mockPage }) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })

    // Toggle sidebar on (may start hidden or visible depending on default)
    await mockPage.keyboard.press('Control+b')
    await mockPage.waitForTimeout(300)

    // The desktop sidebar exposes its resize separator while open.
    const projectsHeader = mockPage.getByRole('separator', {
      name: 'Resize left sidebar',
    })
    const sidebarVisible = await projectsHeader.isVisible().catch(() => false)

    if (sidebarVisible) {
      // Sidebar opened — toggle it closed
      await mockPage.keyboard.press('Control+b')
      await mockPage.waitForTimeout(300)
      await expect(projectsHeader).not.toBeVisible({ timeout: 2000 })
    } else {
      // Sidebar was already open and we closed it — toggle it back open
      await mockPage.keyboard.press('Control+b')
      await mockPage.waitForTimeout(300)
      await expect(projectsHeader).toBeVisible({ timeout: 2000 })
    }
  })

  test('Escape closes command palette', async ({ mockPage }) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })

    await mockPage.keyboard.press('Control+k')
    const input = mockPage.locator('[cmdk-input]')
    await expect(input).toBeVisible({ timeout: 3000 })

    await mockPage.keyboard.press('Escape')
    await expect(input).not.toBeVisible({ timeout: 2000 })
  })
})
