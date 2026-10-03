import {
  test,
  expect,
  activateWorktree,
  createJeanSession,
} from '../fixtures/tauri-mock'

test.describe('Model Selection', () => {
  test('model selector shows current model in chat toolbar', async ({
    mockPage,
  }) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })

    // Navigate to a worktree chat view
    await activateWorktree(mockPage, 'fuzzy-tiger')

    await createJeanSession(mockPage)

    // The default model is "sonnet" — the picker should show "Sonnet".
    const modelCombobox = mockPage.getByRole('button', {
      name: 'Choose backend and model',
    })
    await expect(modelCombobox).toBeVisible({ timeout: 3000 })
    await expect(modelCombobox).toContainText('Sonnet')
  })

  test('changing model updates the selector value', async ({ mockPage }) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })

    await activateWorktree(mockPage, 'fuzzy-tiger')

    // Create a session first (model change requires an active session)
    await createJeanSession(mockPage)
    await mockPage.waitForTimeout(500)

    // Open the backend and model picker.
    const modelCombobox = mockPage.getByRole('button', {
      name: 'Choose backend and model',
    })
    await expect(modelCombobox).toBeVisible({ timeout: 3000 })
    await expect(modelCombobox).toContainText('Sonnet')
    await modelCombobox.click()
    await mockPage.waitForTimeout(200)

    // Select "Opus 4.6"
    await mockPage
      .getByRole('option', { name: /^Opus 4\.6 claude-opus-4-6 Favorite/ })
      .click()
    await mockPage.waitForTimeout(500)

    // Verify the selector now shows Opus 4.6
    const updatedCombobox = mockPage.getByRole('button', {
      name: 'Choose backend and model',
    })
    await expect(updatedCombobox).toBeVisible({ timeout: 3000 })
    await expect(updatedCombobox).toContainText('Opus 4.6')
  })
})
