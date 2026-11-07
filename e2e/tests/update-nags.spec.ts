import { test, expect } from '../fixtures/tauri-mock'

for (const channel of ['desktop', 'server']) {
  test.describe(`passive ${channel} updates`, () => {
    test.use({
      responseOverrides: {
        apply_server_update: {
          success: true,
          version: '9.9.9',
          message: 'Installed requested update',
          restartScheduled: false,
        },
        check_server_update: {
          updateAvailable: true,
          currentVersion: '1.0.0',
          latestVersion: '9.9.9',
          canUpdate: true,
          channel,
        },
      },
    })

    test('does not interrupt startup or reload', async ({ mockPage }) => {
      const label = channel === 'desktop' ? 'Update available' : 'Server update'
      for (let visit = 0; visit < 2; visit++) {
        if (visit) await mockPage.reload()
        await expect(
          mockPage.getByRole('button', { name: label, exact: true })
        ).toBeVisible({
          timeout: 12_000,
        })
        await expect(mockPage.locator('[data-sonner-toast]')).toHaveCount(0)
        await expect(
          mockPage.getByRole('dialog', { name: /Update (Available|Ready)/ })
        ).toHaveCount(0)
        await expect(
          mockPage.getByText('Test Project', { exact: true })
        ).toBeVisible()
      }
      await mockPage.getByRole('button', { name: label, exact: true }).click()
      await expect(
        mockPage.getByText('Installed requested update', { exact: true })
      ).toBeVisible()
      await expect(
        mockPage.getByRole('button', { name: label, exact: true })
      ).toHaveCount(0)
    })
  })
}
