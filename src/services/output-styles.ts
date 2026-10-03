import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invokeForServer } from '@/lib/transport'
import { useSettingsTargetServerId } from '@/lib/settings-target'
import { logger } from '@/lib/logger'
import { isTauri } from '@/services/projects'
import type {
  ClaudeOutputStyle,
  OutputStyleDocument,
  OutputStyleScope,
} from '@/types/output-styles'

export const outputStyleQueryKeys = {
  all: ['claude-output-styles'] as const,
  scope: (serverId = 'local') =>
    serverId === 'local'
      ? outputStyleQueryKeys.all
      : (['claude-output-styles-server', serverId] as const),
  list: (worktreePath?: string | null, serverId = 'local') =>
    [
      ...outputStyleQueryKeys.scope(serverId),
      'list',
      worktreePath ?? 'global',
    ] as const,
  document: (path: string, serverId = 'local') =>
    [...outputStyleQueryKeys.scope(serverId), 'document', path] as const,
}

export function useClaudeOutputStyles(
  worktreePath?: string | null,
  targetServerId?: string
) {
  const settingsServerId = useSettingsTargetServerId()
  const serverId = targetServerId ?? settingsServerId
  return useQuery({
    queryKey: outputStyleQueryKeys.list(worktreePath, serverId),
    queryFn: async (): Promise<ClaudeOutputStyle[]> => {
      if (!isTauri()) return []

      try {
        return await invokeForServer<ClaudeOutputStyle[]>(
          serverId,
          'list_claude_output_styles',
          {
            worktreePath: worktreePath ?? undefined,
          }
        )
      } catch (error) {
        logger.error('Failed to load Claude output styles', { error })
        return []
      }
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
  })
}

export function useReadOutputStyle(path: string | null) {
  const serverId = useSettingsTargetServerId()
  return useQuery({
    queryKey: outputStyleQueryKeys.document(path ?? '', serverId),
    enabled: Boolean(path) && isTauri(),
    queryFn: async (): Promise<OutputStyleDocument | null> => {
      if (!path) return null
      return await invokeForServer<OutputStyleDocument>(
        serverId,
        'read_claude_output_style',
        {
          path,
        }
      )
    },
  })
}

export function useSaveOutputStyle() {
  const serverId = useSettingsTargetServerId()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      name: string
      body: string
      description?: string | null
      keepCodingInstructions?: boolean
      scope: OutputStyleScope
      worktreePath?: string | null
    }): Promise<string> =>
      await invokeForServer<string>(serverId, 'save_claude_output_style', {
        name: input.name,
        body: input.body,
        description: input.description ?? undefined,
        keepCodingInstructions: input.keepCodingInstructions,
        scope: input.scope,
        worktreePath: input.worktreePath ?? undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: outputStyleQueryKeys.scope(serverId),
      })
    },
  })
}

export function useInstallOutputStyle(targetServerId?: string) {
  const settingsServerId = useSettingsTargetServerId()
  const serverId = targetServerId ?? settingsServerId
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      slug: string
      scope?: OutputStyleScope
      worktreePath?: string | null
      overwrite?: boolean
    }): Promise<string> =>
      await invokeForServer<string>(serverId, 'install_claude_output_style', {
        slug: input.slug,
        scope: input.scope ?? 'user',
        worktreePath: input.worktreePath ?? undefined,
        overwrite: input.overwrite,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: outputStyleQueryKeys.scope(serverId),
      })
    },
  })
}

export function useDeleteOutputStyle() {
  const serverId = useSettingsTargetServerId()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      path: string
      worktreePath?: string | null
    }): Promise<void> => {
      await invokeForServer(serverId, 'delete_claude_output_style', {
        path: input.path,
        worktreePath: input.worktreePath ?? undefined,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: outputStyleQueryKeys.scope(serverId),
      })
    },
  })
}
