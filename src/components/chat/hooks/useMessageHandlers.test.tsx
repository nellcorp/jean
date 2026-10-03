import type { PropsWithChildren, RefObject } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EffortLevel, ExecutionMode, ThinkingLevel } from '@/types/chat'
import type { CliBackend } from '@/types/preferences'
import { useChatStore } from '@/store/chat-store'
import { useMessageHandlers } from './useMessageHandlers'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(() => Promise.resolve()),
  listen: vi.fn(),
  markPlanApproved: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/transport', () => ({
  invoke: mocks.invoke,
  listen: mocks.listen,
}))

vi.mock('@/services/chat', async () => {
  const actual = await vi.importActual('@/services/chat')
  return {
    ...(actual as object),
    markPlanApproved: mocks.markPlanApproved,
  }
})

const ref = <T,>(current: T): RefObject<T> => ({ current })

function renderMessageHandlers() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const sendMessage = { mutate: vi.fn() }
  const selectedBackendRef = ref('codex' as CliBackend)
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  const hook = renderHook(
    () =>
      useMessageHandlers({
        activeSessionIdRef: ref('session-1'),
        activeWorktreeIdRef: ref('worktree-1'),
        activeWorktreePathRef: ref('/repo/worktree'),
        selectedModelRef: ref('gpt-6.1-sol'),
        buildModelRef: ref(null),
        buildBackendRef: ref(null),
        buildThinkingLevelRef: ref(null),
        buildEffortLevelRef: ref(null),
        yoloModelRef: ref(null),
        yoloBackendRef: ref(null),
        yoloThinkingLevelRef: ref(null),
        yoloEffortLevelRef: ref(null),
        selectedBackendRef,
        getCustomProfileName: () => undefined,
        executionModeRef: ref('plan' as ExecutionMode),
        selectedThinkingLevelRef: ref('off' as ThinkingLevel),
        selectedEffortLevelRef: ref('medium' as EffortLevel),
        useAdaptiveThinkingRef: ref(true),
        getMcpConfig: () => undefined,
        sendMessage,
        createSession: { mutateAsync: vi.fn() },
        queryClient,
        scrollToBottom: vi.fn(),
        markAtBottom: vi.fn(),
        inputRef: ref(null),
        pendingPlanMessage: null,
        projectIdRef: ref(null),
      }),
    { wrapper }
  )
  return { hook, selectedBackendRef, sendMessage }
}

describe('useMessageHandlers plan approval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useChatStore.setState({
      sendingSessionIds: {},
      executionModes: {},
      selectedModels: {},
      lastSentMessages: {},
      errors: {},
    })
  })

  it('preserves the Codex backend when approving a plan in yolo mode', async () => {
    let finishPersistence!: () => void
    mocks.markPlanApproved.mockReturnValueOnce(
      new Promise<void>(resolve => {
        finishPersistence = resolve
      })
    )
    const { hook, selectedBackendRef, sendMessage } = renderMessageHandlers()

    act(() => hook.result.current.handlePlanApprovalYolo('plan-message-1'))
    selectedBackendRef.current = 'claude'
    finishPersistence()

    await waitFor(() => expect(sendMessage.mutate).toHaveBeenCalled())
    expect(sendMessage.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-6.1-sol',
        backend: 'codex',
        executionMode: 'yolo',
      }),
      expect.any(Object)
    )
  })
})
