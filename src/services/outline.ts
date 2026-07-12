import { useQuery } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { logger } from '@/lib/logger'
import type { OutlineCollection } from '@/types/outline'
import { isTauri, useProjects } from './projects'
import { usePreferences } from './preferences'

function hasValue(value: string | null | undefined): boolean {
  return !!value?.trim()
}

/**
 * Outline is usable when an API token is available (project or global) and the
 * global instance URL is configured.
 */
export function useHasOutlineAccess(projectId: string | null): boolean {
  const { data: projects } = useProjects()
  const { data: preferences } = usePreferences()
  const project = projects?.find(p => p.id === projectId)

  const hasKey =
    hasValue(project?.outline_api_key ?? null) ||
    hasValue(preferences?.outline_api_key ?? null)
  const hasUrl = hasValue(preferences?.outline_url ?? null)
  return hasKey && hasUrl
}

// Query keys for Outline
export const outlineQueryKeys = {
  all: ['outline'] as const,
  collections: (projectId: string) =>
    [...outlineQueryKeys.all, 'collections', projectId] as const,
  documents: (projectId: string) =>
    [...outlineQueryKeys.all, 'documents', projectId] as const,
}

/**
 * Hook to list Outline collections for a project.
 */
export function useOutlineCollections(
  projectId: string | null,
  options?: { enabled?: boolean }
) {
  const hasOutlineAccess = useHasOutlineAccess(projectId)

  return useQuery({
    queryKey: outlineQueryKeys.collections(projectId ?? ''),
    queryFn: async (): Promise<OutlineCollection[]> => {
      if (!isTauri() || !projectId || !hasOutlineAccess) {
        return []
      }

      try {
        logger.debug('Fetching Outline collections', { projectId })
        const result = await invoke<OutlineCollection[]>(
          'list_outline_collections',
          { projectId }
        )
        logger.info('Outline collections loaded', { count: result.length })
        return result
      } catch (error) {
        logger.error('Failed to load Outline collections', { error, projectId })
        throw error
      }
    },
    enabled: (options?.enabled ?? true) && !!projectId && hasOutlineAccess,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
    retry: 1,
  })
}
