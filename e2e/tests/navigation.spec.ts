import { test, expect } from '../fixtures/tauri-mock'

test.describe('Navigation', () => {
  test('sidebar shows project with worktrees', async ({ mockPage }) => {
    // Wait for app to load
    await expect(
      mockPage
        .getByRole('heading', { name: 'Test Project', exact: true })
        .first()
    ).toBeVisible({
      timeout: 5000,
    })

    // Open sidebar panel if not visible
    const projectsHeader = mockPage.getByRole('tab', {
      name: 'projects',
      exact: true,
    })
    if (!(await projectsHeader.isVisible().catch(() => false))) {
      await mockPage.keyboard.press('Control+b')
      await mockPage.waitForTimeout(500)
    }

    // Sidebar should show project and worktrees
    await expect(projectsHeader).toBeVisible({ timeout: 3000 })
    await expect(
      mockPage.getByText('fuzzy-tiger', { exact: true }).first()
    ).toBeVisible({
      timeout: 3000,
    })
    await expect(
      mockPage.getByText('calm-dolphin', { exact: true }).first()
    ).toBeVisible({
      timeout: 3000,
    })
  })

  test('sidebar worktree opens a session modal over the project canvas', async ({
    mockPage,
  }) => {
    await expect(
      mockPage
        .getByRole('heading', { name: 'Test Project', exact: true })
        .first()
    ).toBeVisible({
      timeout: 5000,
    })

    // Open sidebar
    const projectsHeader = mockPage.getByRole('tab', {
      name: 'projects',
      exact: true,
    })
    if (!(await projectsHeader.isVisible().catch(() => false))) {
      await mockPage.keyboard.press('Control+b')
      await mockPage.waitForTimeout(500)
    }

    // Sidebar navigation keeps the project canvas visible.
    await mockPage
      .getByRole('button', { name: 'fuzzy-tiger Expand sessions', exact: true })
      .getByText('fuzzy-tiger', { exact: true })
      .click()
    await expect(
      mockPage.getByRole('heading', { name: 'Test Project', exact: true })
    ).toBeVisible()
    await mockPage.waitForTimeout(1000)

    // Opening a worktree presents its session modal.
    await expect(
      mockPage.getByRole('heading', { name: /^Test Project ›\s*fuzzy-tiger$/ })
    ).toBeVisible()
    await expect(
      mockPage.getByRole('button', { name: 'New session', exact: true }).first()
    ).toBeVisible()
  })
})
