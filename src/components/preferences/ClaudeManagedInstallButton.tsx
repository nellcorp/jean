import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from '@/components/icons/reicon'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { invoke } from '@/lib/transport'
import { claudeCliQueryKeys, useInstallProgress } from '@/services/claude-cli'
import {
  preferencesQueryKeys,
  usePatchPreferences,
} from '@/services/preferences'

export function ClaudeManagedInstallButton({
  managedInstalled,
}: {
  managedInstalled: boolean | undefined
}) {
  const queryClient = useQueryClient()
  const patchPreferences = usePatchPreferences()
  const [progress, resetProgress] = useInstallProgress()
  const [isInstalling, setIsInstalling] = useState(false)
  const installing = useRef(false)

  const install = async () => {
    if (installing.current) return
    installing.current = true
    setIsInstalling(true)
    resetProgress()
    let installed = false
    try {
      await invoke('install_claude_cli', { version: null })
      installed = true
      await patchPreferences.mutateAsync({ claude_cli_source: 'jean' })
      toast.success('Claude CLI installed successfully')
    } catch (error) {
      toast.error(
        installed
          ? 'Claude CLI installed, but failed to select Jean managed'
          : 'Failed to install Claude CLI',
        {
          description: error instanceof Error ? error.message : String(error),
        }
      )
    } finally {
      if (installed) {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: claudeCliQueryKeys.status(),
          }),
          queryClient.invalidateQueries({
            queryKey: claudeCliQueryKeys.auth(),
          }),
          queryClient.invalidateQueries({
            queryKey: preferencesQueryKeys.preferences(),
          }),
        ])
      }
      installing.current = false
      setIsInstalling(false)
    }
  }

  if (managedInstalled !== false) return null

  return (
    <div className="space-y-2">
      <Button type="button" size="sm" disabled={isInstalling} onClick={install}>
        {isInstalling && <Loader2 className="size-4 animate-spin" />}
        {isInstalling ? 'Installing...' : 'Install latest'}
      </Button>
      {isInstalling && progress && (
        <p role="status" className="text-xs text-muted-foreground">
          {progress.message} ({progress.percent}%)
        </p>
      )}
    </div>
  )
}
