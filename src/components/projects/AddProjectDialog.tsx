import { useCallback, useEffect, useState } from 'react'
import { isNativeApp } from '@/lib/environment'
import { invoke } from '@/lib/transport'
import {
  ArrowLeft,
  FolderOpen,
  FolderPlus,
  Globe,
  Loader2,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Kbd } from '@/components/ui/kbd'
import { useProjectsStore } from '@/store/projects-store'
import { useAddProject, useInitProject } from '@/services/projects'

type WebMode = 'choose' | 'add' | 'init'

export function AddProjectDialog() {
  const {
    addProjectDialogOpen,
    addProjectParentFolderId,
    setAddProjectDialogOpen,
  } = useProjectsStore()
  const addProject = useAddProject()
  const initProject = useInitProject()

  const native = isNativeApp()
  const [webMode, setWebMode] = useState<WebMode>('choose')
  const [webPath, setWebPath] = useState('')
  const [webError, setWebError] = useState<string | null>(null)

  // Reset sub-view state when the dialog closes
  useEffect(() => {
    if (!addProjectDialogOpen) {
      setWebMode('choose')
      setWebPath('')
      setWebError(null)
    }
  }, [addProjectDialogOpen])

  const handleCloneRemote = useCallback(() => {
    const { openCloneModal } = useProjectsStore.getState()
    openCloneModal()
  }, [])

  const isPending = addProject.isPending || initProject.isPending

  const handleAddExistingNative = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select a git repository',
      })

      if (selected && typeof selected === 'string') {
        try {
          await addProject.mutateAsync({
            path: selected,
            parentId: addProjectParentFolderId ?? undefined,
          })
          setAddProjectDialogOpen(false)
        } catch (error) {
          // Check if error is "not a git repository"
          const errorMessage =
            typeof error === 'string'
              ? error
              : error instanceof Error
                ? error.message
                : ''

          if (
            errorMessage.includes('not a git repository') ||
            errorMessage.includes("ambiguous argument 'HEAD'")
          ) {
            // Open the git init modal instead of showing toast
            // This handles both: folder without git, and git repo without commits
            const { openGitInitModal } = useProjectsStore.getState()
            openGitInitModal(selected)
          }
          // Other errors are handled by mutation's onError (shows toast)
        }
      }
    } catch (error) {
      // User cancelled - don't show error
      if (error instanceof Error && error.message.includes('cancel')) {
        return
      }
      // Other errors handled by mutation
    }
  }, [addProject, addProjectParentFolderId, setAddProjectDialogOpen])

  const handleInitNewNative = useCallback(async () => {
    try {
      // Use save dialog to let user pick location and name for new project
      const { save } = await import('@tauri-apps/plugin-dialog')
      const selected = await save({
        title: 'Create new project',
        defaultPath: 'my-project',
      })

      if (selected && typeof selected === 'string') {
        // Check if git identity is configured before init (commit requires it)
        try {
          const identity = await invoke<{
            name: string | null
            email: string | null
          }>('check_git_identity')
          if (!identity.name || !identity.email) {
            // Identity not configured - route through GitInitModal which handles identity setup
            const { openGitInitModal } = useProjectsStore.getState()
            openGitInitModal(selected)
            return
          }
        } catch {
          // If check fails, try anyway and let the error surface naturally
        }

        await initProject.mutateAsync({
          path: selected,
          parentId: addProjectParentFolderId ?? undefined,
        })
        setAddProjectDialogOpen(false)
      }
    } catch (error) {
      // User cancelled - don't show error
      if (error instanceof Error && error.message.includes('cancel')) {
        return
      }
      // Other errors handled by mutation
    }
  }, [initProject, addProjectParentFolderId, setAddProjectDialogOpen])

  const handleAddExisting = useCallback(() => {
    if (native) {
      handleAddExistingNative()
    } else {
      setWebError(null)
      setWebPath('')
      setWebMode('add')
    }
  }, [native, handleAddExistingNative])

  const handleInitNew = useCallback(() => {
    if (native) {
      handleInitNewNative()
    } else {
      setWebError(null)
      setWebPath('')
      setWebMode('init')
    }
  }, [native, handleInitNewNative])

  const handleBackToChoose = useCallback(() => {
    setWebMode('choose')
    setWebError(null)
    setWebPath('')
  }, [])

  const handleWebSubmit = useCallback(async () => {
    const trimmed = webPath.trim()
    if (!trimmed) {
      setWebError('Please enter a path.')
      return
    }

    setWebError(null)

    if (webMode === 'add') {
      try {
        await addProject.mutateAsync({
          path: trimmed,
          parentId: addProjectParentFolderId ?? undefined,
        })
        setAddProjectDialogOpen(false)
      } catch (error) {
        const errorMessage =
          typeof error === 'string'
            ? error
            : error instanceof Error
              ? error.message
              : ''

        if (
          errorMessage.includes('not a git repository') ||
          errorMessage.includes("ambiguous argument 'HEAD'")
        ) {
          const { openGitInitModal } = useProjectsStore.getState()
          openGitInitModal(trimmed)
        }
        // Other errors are handled by mutation's onError (shows toast)
      }
      return
    }

    if (webMode === 'init') {
      try {
        const identity = await invoke<{
          name: string | null
          email: string | null
        }>('check_git_identity')
        if (!identity.name || !identity.email) {
          const { openGitInitModal } = useProjectsStore.getState()
          openGitInitModal(trimmed)
          return
        }
      } catch {
        // If check fails, try anyway and let the error surface naturally
      }

      try {
        await initProject.mutateAsync({
          path: trimmed,
          parentId: addProjectParentFolderId ?? undefined,
        })
        setAddProjectDialogOpen(false)
      } catch {
        // handled by mutation's onError
      }
    }
  }, [
    webPath,
    webMode,
    addProject,
    initProject,
    addProjectParentFolderId,
    setAddProjectDialogOpen,
  ])

  // Keyboard shortcuts: A = add existing, I = initialize new, C = clone
  useEffect(() => {
    if (!addProjectDialogOpen || isPending) return
    // Only the "choose" screen has shortcuts; the path-entry form uses
    // a regular text input that would otherwise swallow letters.
    if (webMode !== 'choose') return
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when another modal is on top
      const { gitInitModalOpen, cloneModalOpen } = useProjectsStore.getState()
      if (gitInitModalOpen || cloneModalOpen) return

      // Don't intercept when typing in an input field
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )
        return

      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault()
        handleAddExisting()
      } else if (e.key === 'i' || e.key === 'I') {
        e.preventDefault()
        handleInitNew()
      } else if (e.key === 'c' || e.key === 'C') {
        e.preventDefault()
        handleCloneRemote()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    addProjectDialogOpen,
    isPending,
    webMode,
    handleAddExisting,
    handleInitNew,
    handleCloneRemote,
  ])

  const showPathForm = webMode === 'add' || webMode === 'init'

  return (
    <Dialog open={addProjectDialogOpen} onOpenChange={setAddProjectDialogOpen}>
      <DialogContent className="sm:max-w-md">
        {showPathForm ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {webMode === 'add' ? (
                  <FolderOpen className="h-5 w-5" />
                ) : (
                  <FolderPlus className="h-5 w-5" />
                )}
                {webMode === 'add'
                  ? 'Add Existing Project'
                  : 'Initialize New Project'}
              </DialogTitle>
              <DialogDescription>
                {webMode === 'add'
                  ? 'Enter the absolute path to an existing git repository on the server.'
                  : 'Enter the absolute path where the new project should be created on the server.'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="project-path" className="text-xs">
                  Path
                </Label>
                <Input
                  id="project-path"
                  placeholder={
                    webMode === 'add'
                      ? '/projects/my-repo'
                      : '/projects/my-new-project'
                  }
                  value={webPath}
                  onChange={e => setWebPath(e.target.value)}
                  disabled={isPending}
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter' && webPath.trim()) {
                      e.preventDefault()
                      handleWebSubmit()
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Paths are resolved on the server running Jean.
                </p>
              </div>

              {webError && (
                <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                  {webError}
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                variant="outline"
                onClick={handleBackToChoose}
                disabled={isPending}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              <Button
                onClick={handleWebSubmit}
                disabled={isPending || !webPath.trim()}
              >
                {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {webMode === 'add' ? 'Add Project' : 'Create Project'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>New Project</DialogTitle>
              <DialogDescription>
                Add an existing git repository or create a new one.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 py-4">
              <button
                onClick={handleAddExisting}
                disabled={isPending}
                className="flex items-start gap-4 rounded-lg border border-border p-4 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <FolderOpen className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium leading-none">
                    Add Existing Project
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {native
                      ? 'Select a git repository from your computer'
                      : 'Enter the path to a git repository on the server'}
                  </p>
                </div>
                <Kbd className="mt-1 h-6 px-1.5 text-xs shrink-0">A</Kbd>
              </button>

              <button
                onClick={handleInitNew}
                disabled={isPending}
                className="flex items-start gap-4 rounded-lg border border-border p-4 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <FolderPlus className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium leading-none">
                    Initialize New Project
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Create a new directory with git initialized
                  </p>
                </div>
                <Kbd className="mt-1 h-6 px-1.5 text-xs shrink-0">I</Kbd>
              </button>

              <button
                onClick={handleCloneRemote}
                disabled={isPending}
                className="flex items-start gap-4 rounded-lg border border-border p-4 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Globe className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium leading-none">
                    Clone from Remote
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Clone a repository from a git URL
                  </p>
                </div>
                <Kbd className="mt-1 h-6 px-1.5 text-xs shrink-0">C</Kbd>
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
