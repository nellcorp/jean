/**
 * Playwright test fixture that injects E2E mock transport.
 * Usage: import { test, expect } from '../fixtures/tauri-mock'
 */

import { test as base, expect, type Page } from '@playwright/test'
import { defaultResponses } from './invoke-handlers'

interface TauriMockFixtures {
  /** Page with Tauri mocks injected. Navigates to '/' automatically. */
  mockPage: Page
  /** Override specific command responses for this test. */
  responseOverrides: Record<string, unknown>
  /** Emit a backend event to the app (simulates Rust → React events). */
  emitEvent: (event: string, payload: unknown) => Promise<void>
}

export const test = base.extend<TauriMockFixtures>({
  // Default: no overrides. Tests can set this via test.use({})
  responseOverrides: [{}, { option: true }],

  mockPage: async ({ page, responseOverrides }, use) => {
    const responses = { ...defaultResponses, ...responseOverrides }

    // Keys explicitly overridden — these take precedence over dynamic handlers
    const overrideKeys = Object.keys(responseOverrides)

    await page.addInitScript(
      ({
        responseMap,
        overrideKeys,
      }: {
        responseMap: Record<string, unknown>
        overrideKeys: string[]
      }) => {
        const overrideSet = new Set(overrideKeys)

        // In-memory session store for stateful handlers
        const sessionStore: Record<
          string,
          {
            sessions: Array<Record<string, unknown>>
            active_session_id: string | null
          }
        > = {}
        const worktreeStore: Array<Record<string, unknown>> = Array.isArray(
          responseMap.list_worktrees
        )
          ? structuredClone(responseMap.list_worktrees)
          : []

        function getWorktreeStore(worktreeId: string) {
          if (!sessionStore[worktreeId]) {
            const seededWorktree = worktreeStore.find(
              worktree => worktree.id === worktreeId
            )
            const seededSessions = Array.isArray(seededWorktree?.sessions)
              ? structuredClone(
                  seededWorktree.sessions as Record<string, unknown>[]
                )
              : []
            sessionStore[worktreeId] = {
              sessions: seededSessions,
              active_session_id:
                typeof seededSessions[0]?.id === 'string'
                  ? seededSessions[0].id
                  : null,
            }
          }
          return sessionStore[worktreeId]
        }

        // Commands that need dynamic responses based on args
        const dynamicHandlers: Record<
          string,
          (args?: Record<string, unknown>) => unknown
        > = {
          get_worktree: args =>
            structuredClone(
              worktreeStore.find(
                worktree => worktree.id === args?.worktreeId
              ) ?? null
            ),
          bootstrap_project: args => {
            const projectId = args?.projectId
            const worktrees = worktreeStore.filter(
              worktree => worktree.project_id === projectId
            )
            const sessionsByWorktree = Object.fromEntries(
              worktrees.map(worktree => {
                const worktreeId = String(worktree.id)
                return [
                  worktreeId,
                  {
                    worktree_id: worktreeId,
                    ...getWorktreeStore(worktreeId),
                    version: 2,
                  },
                ]
              })
            )
            return {
              worktrees: structuredClone(worktrees),
              sessionsByWorktree: structuredClone(sessionsByWorktree),
              runningSessions: [],
            }
          },
          get_sessions: args => {
            const wid = (args?.worktreeId as string) ?? 'unknown'
            const store = getWorktreeStore(wid)
            return {
              worktree_id: wid,
              sessions: store.sessions,
              active_session_id: store.active_session_id,
              version: 2,
            }
          },
          list_worktrees: args => {
            const projectId = args?.projectId as string | undefined
            return structuredClone(
              worktreeStore
                .filter(
                  worktree =>
                    projectId == null || worktree.project_id === projectId
                )
                .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
            )
          },
          reorder_worktrees: args => {
            const orderedIds = Array.isArray(args?.worktreeIds)
              ? (args.worktreeIds as string[])
              : []
            const orderById = new Map(
              orderedIds.map((worktreeId, index) => [worktreeId, index + 1])
            )

            for (const worktree of worktreeStore) {
              if (typeof worktree.id !== 'string') continue
              const nextOrder = orderById.get(worktree.id)
              if (nextOrder != null) {
                worktree.order = nextOrder
              }
            }

            return null
          },
          create_session: args => {
            const wid = (args?.worktreeId as string) ?? 'unknown'
            const store = getWorktreeStore(wid)
            const name =
              (args?.name as string) || `Session ${store.sessions.length + 1}`
            const session = {
              id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              name,
              order: store.sessions.length,
              created_at: Date.now() / 1000,
              messages: [],
            }
            store.sessions.unshift(session)
            store.active_session_id = session.id
            return session
          },
          rename_session: args => {
            const wid = (args?.worktreeId as string) ?? 'unknown'
            const store = getWorktreeStore(wid)
            const session = store.sessions.find(s => s.id === args?.sessionId)
            if (session) {
              session.name = args?.newName as string
            }
            return null
          },
          set_active_session: args => {
            const wid = (args?.worktreeId as string) ?? 'unknown'
            const store = getWorktreeStore(wid)
            store.active_session_id = (args?.sessionId as string) ?? null
            return null
          },
          set_session_model: args => {
            const wid = (args?.worktreeId as string) ?? 'unknown'
            const store = getWorktreeStore(wid)
            const session = store.sessions.find(s => s.id === args?.sessionId)
            if (session) {
              session.selected_model = args?.model as string
            }
            return null
          },
          get_session: args => {
            const wid = (args?.worktreeId as string) ?? 'unknown'
            const store = getWorktreeStore(wid)
            const session = store.sessions.find(s => s.id === args?.sessionId)
            return session
              ? structuredClone(session)
              : {
                  id: args?.sessionId ?? 'unknown',
                  name: 'Session',
                  order: 0,
                  created_at: Date.now() / 1000,
                  messages: [],
                }
          },
          send_chat_message: args => {
            // Return a mock assistant ChatMessage
            // Actual streaming is handled via emitEvent
            return {
              id: `msg-${Date.now()}`,
              session_id: args?.sessionId ?? 'unknown',
              role: 'assistant',
              content: 'Mock response',
              content_blocks: [{ type: 'text', text: 'Mock response' }],
              timestamp: Math.floor(Date.now() / 1000),
              cost_usd: 0.001,
              duration_ms: 500,
              model: 'sonnet',
              tool_calls: [],
              cancelled: false,
            }
          },
        }

        const handlers: Record<string, (args?: any) => unknown> = {}

        for (const [cmd, data] of Object.entries(responseMap)) {
          // Keep worktree list overrides stateful so reorder_worktrees can update
          // the same in-memory data during tests.
          if (cmd === 'list_worktrees' || cmd === 'reorder_worktrees') {
            handlers[cmd] = dynamicHandlers[cmd]
          } else if (overrideSet.has(cmd)) {
            // If explicitly overridden, use static response (override wins over dynamic)
            handlers[cmd] = () => structuredClone(data)
          } else if (dynamicHandlers[cmd]) {
            handlers[cmd] = dynamicHandlers[cmd]
          } else {
            handlers[cmd] = () => structuredClone(data)
          }
        }

        // Also add dynamic handlers that aren't in the response map
        for (const [cmd, handler] of Object.entries(dynamicHandlers)) {
          if (!handlers[cmd]) {
            handlers[cmd] = handler
          }
        }

        ;(window as any).__JEAN_E2E_MOCK__ = {
          invokeHandlers: handlers,
          eventEmitter: new EventTarget(),
        }
      },
      { responseMap: responses, overrideKeys }
    )

    await page.goto('/')
    await use(page)
  },

  emitEvent: async ({ mockPage }, use) => {
    const emitFn = async (event: string, payload: unknown) => {
      await mockPage.evaluate(
        ({ event, payload }) => {
          const emitter = (window as any).__JEAN_E2E_MOCK__?.eventEmitter
          if (emitter) {
            emitter.dispatchEvent(new CustomEvent(event, { detail: payload }))
          }
        },
        { event, payload }
      )
    }
    await use(emitFn)
  },
})

export { expect }

/**
 * Helper: open sidebar and click a worktree to activate it.
 * Waits for the chat view to appear.
 */
export async function activateWorktree(
  page: Page,
  worktreeName: string
): Promise<void> {
  const worktree = page.getByText(worktreeName, { exact: true }).first()
  await expect(worktree).toBeVisible({ timeout: 5000 })
  await worktree.click()
  await expect(
    page.getByRole('button', { name: 'New session', exact: true }).first()
  ).toBeVisible({ timeout: 5000 })
}

export async function createJeanSession(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: 'New session', exact: true })
    .first()
    .click()
  const chooser = page.getByRole('dialog', { name: 'New session', exact: true })
  await expect(chooser).toBeVisible()
  await chooser.getByRole('button', { name: /^Jean Chat/ }).click()
  await expect(chooser).not.toBeVisible()
}
