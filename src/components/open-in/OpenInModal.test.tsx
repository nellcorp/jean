import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { OpenInModal } from './OpenInModal'
import { OpenInButton } from './OpenInButton'
import { TooltipProvider } from '@/components/ui/tooltip'

const localBackendState = vi.hoisted(() => ({ value: true }))
const nativeOpenAllowedState = vi.hoisted(() => ({ value: false }))
const remoteEditorLocallyState = vi.hoisted(() => ({ value: false }))
const serverState = vi.hoisted(() => ({ id: 'local' }))
const webEditorUrlState = vi.hoisted(() => ({ value: null as string | null }))

const mocks = vi.hoisted(() => ({
  setOpenInModalOpen: vi.fn(),
  openPreferencesPane: vi.fn(),
  openRemotePicker: vi.fn(),
  openExternal: vi.fn(),
  preOpenWindow: vi.fn(),
  openInEditor: vi.fn(),
}))

interface UiStoreMock {
  openInModalOpen: boolean
  setOpenInModalOpen: typeof mocks.setOpenInModalOpen
  openPreferencesPane: typeof mocks.openPreferencesPane
  sessionChatModalWorktreeId: string | null
  openRemotePicker: typeof mocks.openRemotePicker
}

interface ProjectsStoreMock {
  selectedWorktreeId: string
  selectedProjectId: string
}

interface ChatStoreMock {
  activeWorktreeId: string | null
  activeSessionIds: Record<string, string>
}

vi.mock('@/store/ui-store', () => ({
  useUIStore: (selector?: (state: UiStoreMock) => unknown) => {
    const state = {
      openInModalOpen: true,
      setOpenInModalOpen: mocks.setOpenInModalOpen,
      openPreferencesPane: mocks.openPreferencesPane,
      sessionChatModalWorktreeId: null,
      openRemotePicker: mocks.openRemotePicker,
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('@/store/projects-store', () => ({
  useProjectsStore: (selector?: (state: ProjectsStoreMock) => unknown) => {
    const state = {
      selectedWorktreeId: 'wt-1',
      selectedProjectId: 'project-1',
    }
    return selector ? selector(state) : state
  },
}))

vi.mock('@/store/chat-store', () => ({
  useChatStore: Object.assign(
    (selector?: (state: ChatStoreMock) => unknown) => {
      const state = {
        activeWorktreeId: null,
        activeSessionIds: { 'wt-1': 'session-1' },
      }
      return selector ? selector(state) : state
    },
    {
      getState: () => ({
        getWorktreePath: () => '/repo/worktree',
      }),
    }
  ),
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({
    data: { editor: 'zed', terminal: 'ghostty' },
  }),
}))

vi.mock('@/lib/environment', () => ({
  isLocalBackend: () => localBackendState.value,
  isNativeApp: () => localBackendState.value || remoteEditorLocallyState.value,
  canOpenNativeApps: () =>
    localBackendState.value || nativeOpenAllowedState.value,
  canOpenInTerminal: () =>
    localBackendState.value ||
    nativeOpenAllowedState.value ||
    remoteEditorLocallyState.value,
  canOpenInFinder: (serverId?: string) =>
    localBackendState.value && (!serverId || serverId === 'local'),
  canOpenRemoteEditorLocally: () => remoteEditorLocallyState.value,
  canOpenInEditor: () =>
    localBackendState.value ||
    nativeOpenAllowedState.value ||
    remoteEditorLocallyState.value,
  isNativeOpenAllowed: () => nativeOpenAllowedState.value,
}))

vi.mock('@/lib/platform', () => ({
  openExternal: mocks.openExternal,
  preOpenWindow: mocks.preOpenWindow,
  isMacOS: true,
  isWindows: false,
  isLinux: false,
  getServerPlatform: vi.fn(() => 'mac'),
  isServerWindows: vi.fn(() => false),
}))

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(() => Promise.resolve([])),
}))

vi.mock('@/lib/notifications', () => ({
  notify: vi.fn(),
}))

vi.mock('@/services/projects', () => ({
  useWorktree: () => ({
    data: {
      id: 'wt-1',
      serverId: serverState.id,
      path: '/repo/worktree',
      branch: 'fix-advisory',
      pr_url: null,
      pr_number: null,
      security_alert_url: 'https://github.com/acme/app/security/dependabot/7',
      security_alert_number: 7,
      advisory_url:
        'https://github.com/acme/app/security/advisories/GHSA-892v-qq52-xprh',
      advisory_ghsa_id: 'GHSA-892v-qq52-xprh',
    },
  }),
  useProjects: () => ({
    data: [{ id: 'project-1', path: '/repo', name: 'app' }],
  }),
  useOpenBranchOnGitHub: () => ({ mutate: vi.fn() }),
  useOpenWorktreeInFinder: () => ({ mutate: vi.fn() }),
  useOpenWorktreeInTerminal: () => ({ mutate: vi.fn() }),
  useOpenWorktreeInEditor: () => ({ mutate: mocks.openInEditor }),
  useWebEditorUrl: () => webEditorUrlState.value,
  usePorts: () => ({ data: [] }),
}))

vi.mock('@/services/github', () => ({
  useLoadedIssueContexts: () => ({ data: [] }),
  useLoadedPRContexts: () => ({ data: [] }),
  useLoadedSecurityContexts: vi.fn((sessionId: string, worktreeId: string) => ({
    data:
      sessionId === 'session-1' && worktreeId === 'wt-1'
        ? [
            {
              number: 9,
              packageName: 'lodash',
              summary: 'Prototype pollution',
              severity: 'high',
              repoOwner: 'acme',
              repoName: 'app',
            },
          ]
        : [],
  })),
  useLoadedAdvisoryContexts: vi.fn((sessionId: string, worktreeId: string) => ({
    data:
      sessionId === 'session-1' && worktreeId === 'wt-1'
        ? [
            {
              ghsaId: 'GHSA-loaded-1234-5678',
              summary: 'Loaded advisory',
              severity: 'critical',
              repoOwner: 'acme',
              repoName: 'app',
            },
          ]
        : [],
  })),
}))

describe('OpenInModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.preOpenWindow.mockReturnValue(window)
    localBackendState.value = true
    nativeOpenAllowedState.value = false
    remoteEditorLocallyState.value = false
    webEditorUrlState.value = null
    serverState.id = 'local'
  })

  it('hides Finder/editor/terminal in browser/headless mode without native open', async () => {
    localBackendState.value = false
    nativeOpenAllowedState.value = false
    remoteEditorLocallyState.value = false

    render(<OpenInModal />)

    expect(await screen.findByText('GitHub')).toBeInTheDocument()
    expect(screen.queryByText('Finder')).not.toBeInTheDocument()
    expect(screen.queryByText('Zed')).not.toBeInTheDocument()
    expect(screen.queryByText('Ghostty')).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' })
    expect(mocks.openInEditor).not.toHaveBeenCalled()
  })

  it('offers the browser editor when a web editor URL is configured', async () => {
    localBackendState.value = false
    nativeOpenAllowedState.value = false
    remoteEditorLocallyState.value = false
    webEditorUrlState.value = '/code'

    render(<OpenInModal />)

    fireEvent.click(await screen.findByText('Open Editor'))
    expect(mocks.preOpenWindow).toHaveBeenCalledOnce()
    expect(mocks.openInEditor).toHaveBeenCalledWith({
      worktreePath: '/repo/worktree',
      editor: 'zed',
      preOpenedWindow: window,
    })
    expect(screen.queryByText('Finder')).not.toBeInTheDocument()
    expect(screen.queryByText('Ghostty')).not.toBeInTheDocument()
  })

  it('hides Finder but shows editor and terminal when a remote backend allows native open', async () => {
    // Browser or remote client against a WSL/--allow-native-open headless server.
    localBackendState.value = false
    nativeOpenAllowedState.value = true
    remoteEditorLocallyState.value = false

    render(<OpenInModal />)

    expect(await screen.findByText('Zed')).toBeInTheDocument()
    expect(screen.queryByText('Finder')).not.toBeInTheDocument()
    expect(screen.getByText('Ghostty')).toBeInTheDocument()
  })

  it('shows Zed and Terminal on remote native connections with SSH', async () => {
    // Native shell + remote Jean: editor and terminal use the local SSH endpoint.
    localBackendState.value = false
    nativeOpenAllowedState.value = false
    remoteEditorLocallyState.value = true

    render(<OpenInModal />)

    expect(await screen.findByText('Zed')).toBeInTheDocument()
    expect(screen.getByText('E')).toBeInTheDocument()
    expect(screen.getByText('GitHub')).toBeInTheDocument()
    expect(screen.queryByText('Finder')).not.toBeInTheDocument()
    expect(screen.getByText('Ghostty')).toBeInTheDocument()
  })

  it('hides Finder/terminal on remote connections without native open or local editor', async () => {
    // Pure browser/web remote without --allow-native-open.
    localBackendState.value = false
    nativeOpenAllowedState.value = false
    remoteEditorLocallyState.value = false

    render(<OpenInModal />)

    expect(await screen.findByText('GitHub')).toBeInTheDocument()
    expect(screen.queryByText('Finder')).not.toBeInTheDocument()
    expect(screen.queryByText(/zed|editor/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/ghostty|terminal/i)).not.toBeInTheDocument()
  })

  it('shows local open targets when connected to the local backend', async () => {
    render(<OpenInModal />)

    expect(await screen.findByText('Zed')).toBeInTheDocument()
    expect(screen.getByText('Ghostty')).toBeInTheDocument()
    expect(screen.getByText('Finder')).toBeInTheDocument()
    expect(screen.getByText('GitHub')).toBeInTheDocument()
  })

  it('hides Finder for a remote worktree on the local desktop', async () => {
    serverState.id = 'remote-1'
    render(<OpenInModal />)
    expect(await screen.findByText('Zed')).toBeInTheDocument()
    expect(screen.queryByText('Finder')).not.toBeInTheDocument()
  })

  it('shows worktree and loaded security/advisory context URLs', async () => {
    render(<OpenInModal />)

    expect(
      await screen.findByText('Advisory GHSA-892v-qq52-xprh')
    ).toBeInTheDocument()
    expect(screen.getByText('Security #7')).toBeInTheDocument()
    expect(screen.getByText('Security #9')).toBeInTheDocument()
    expect(
      screen.getByText('Advisory GHSA-loaded-1234-5678')
    ).toBeInTheDocument()
  })
})

describe('OpenInButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.preOpenWindow.mockReturnValue(window)
    localBackendState.value = false
    nativeOpenAllowedState.value = false
    remoteEditorLocallyState.value = false
    webEditorUrlState.value = null
  })

  it('hides native open controls in an unconfigured browser', () => {
    render(<OpenInButton worktreePath="/repo/worktree" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('opens the configured browser editor from a preopened window', () => {
    webEditorUrlState.value = '/code'
    render(<OpenInButton worktreePath="/repo/worktree" />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Editor' }))
    expect(mocks.preOpenWindow).toHaveBeenCalledOnce()
    expect(mocks.openInEditor).toHaveBeenCalledWith({
      worktreePath: '/repo/worktree',
      editor: 'zed',
      preOpenedWindow: window,
    })
  })

  it('offers the native editor on a remote desktop connection', () => {
    remoteEditorLocallyState.value = true
    render(
      <TooltipProvider>
        <OpenInButton worktreePath="/repo/worktree" serverId="remote-1" />
      </TooltipProvider>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open in Zed' }))
    expect(mocks.openInEditor).toHaveBeenCalledWith({
      worktreePath: '/repo/worktree',
      editor: 'zed',
      preOpenedWindow: null,
    })
    expect(mocks.preOpenWindow).not.toHaveBeenCalled()
  })
})
