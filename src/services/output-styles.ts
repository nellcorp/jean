import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { logger } from '@/lib/logger'
import { isTauri } from '@/services/projects'
import type {
  ClaudeOutputStyle,
  OutputStyleDocument,
  OutputStyleScope,
} from '@/types/output-styles'

export const outputStyleQueryKeys = {
  all: ['claude-output-styles'] as const,
  list: (worktreePath?: string | null) =>
    [...outputStyleQueryKeys.all, 'list', worktreePath ?? 'global'] as const,
  document: (path: string) =>
    [...outputStyleQueryKeys.all, 'document', path] as const,
}

export function useClaudeOutputStyles(worktreePath?: string | null) {
  return useQuery({
    queryKey: outputStyleQueryKeys.list(worktreePath),
    queryFn: async (): Promise<ClaudeOutputStyle[]> => {
      if (!isTauri()) return []

      try {
        return await invoke<ClaudeOutputStyle[]>('list_claude_output_styles', {
          worktreePath: worktreePath ?? undefined,
        })
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
  return useQuery({
    queryKey: outputStyleQueryKeys.document(path ?? ''),
    enabled: Boolean(path) && isTauri(),
    queryFn: async (): Promise<OutputStyleDocument | null> => {
      if (!path) return null
      return await invoke<OutputStyleDocument>('read_claude_output_style', {
        path,
      })
    },
  })
}

export function useSaveOutputStyle() {
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
      await invoke<string>('save_claude_output_style', {
        name: input.name,
        body: input.body,
        description: input.description ?? undefined,
        keepCodingInstructions: input.keepCodingInstructions,
        scope: input.scope,
        worktreePath: input.worktreePath ?? undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: outputStyleQueryKeys.all })
    },
  })
}

export function useInstallOutputStyle() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      slug: string
      scope?: OutputStyleScope
      worktreePath?: string | null
      overwrite?: boolean
    }): Promise<string> =>
      await invoke<string>('install_claude_output_style', {
        slug: input.slug,
        scope: input.scope ?? 'user',
        worktreePath: input.worktreePath ?? undefined,
        overwrite: input.overwrite,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: outputStyleQueryKeys.all })
    },
  })
}

export function useDeleteOutputStyle() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      path: string
      worktreePath?: string | null
    }): Promise<void> => {
      await invoke('delete_claude_output_style', {
        path: input.path,
        worktreePath: input.worktreePath ?? undefined,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: outputStyleQueryKeys.all })
    },
  })
}
