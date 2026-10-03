import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invokeForServer } from '@/lib/transport'
import { useSettingsTargetServerId } from '@/lib/settings-target'
import { logger } from '@/lib/logger'
import { isTauri } from '@/services/projects'
import { skillQueryKeys } from '@/services/skills'
import type {
  JeanSkill,
  JeanSkillDocument,
  SaveSkillResult,
  SkillBackendTarget,
} from '@/types/jean-skills'

export const jeanSkillKeys = {
  all: ['jean-skills'] as const,
  scope: (serverId = 'local') =>
    serverId === 'local'
      ? jeanSkillKeys.all
      : (['jean-skills-server', serverId] as const),
  list: (serverId = 'local') =>
    [...jeanSkillKeys.scope(serverId), 'list'] as const,
  backends: (serverId = 'local') =>
    [...jeanSkillKeys.scope(serverId), 'backends'] as const,
  document: (slug: string, serverId = 'local') =>
    [...jeanSkillKeys.scope(serverId), 'document', slug] as const,
}

export function useJeanSkills() {
  const serverId = useSettingsTargetServerId()
  return useQuery({
    queryKey: jeanSkillKeys.list(serverId),
    queryFn: async (): Promise<JeanSkill[]> => {
      if (!isTauri()) return []

      try {
        return await invokeForServer<JeanSkill[]>(serverId, 'list_jean_skills')
      } catch (error) {
        logger.error('Failed to load skills', { error })
        return []
      }
    },
    staleTime: 1000 * 30,
  })
}

export function useSkillBackends() {
  const serverId = useSettingsTargetServerId()
  return useQuery({
    queryKey: jeanSkillKeys.backends(serverId),
    queryFn: async (): Promise<SkillBackendTarget[]> => {
      if (!isTauri()) return []

      try {
        return await invokeForServer<SkillBackendTarget[]>(
          serverId,
          'list_skill_backends'
        )
      } catch (error) {
        logger.error('Failed to load skill backends', { error })
        return []
      }
    },
    staleTime: 1000 * 60 * 5,
  })
}

export function useReadJeanSkill(slug: string | null) {
  const serverId = useSettingsTargetServerId()
  return useQuery({
    queryKey: jeanSkillKeys.document(slug ?? '', serverId),
    enabled: Boolean(slug) && isTauri(),
    queryFn: async (): Promise<JeanSkillDocument | null> => {
      if (!slug) return null
      return await invokeForServer<JeanSkillDocument>(
        serverId,
        'read_jean_skill',
        { slug }
      )
    },
  })
}

/** Skill writes change what the slash-command picker can offer. */
function invalidateSkillQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  serverId: string
) {
  queryClient.invalidateQueries({ queryKey: jeanSkillKeys.scope(serverId) })
  queryClient.invalidateQueries({ queryKey: skillQueryKeys.all })
}

export function useSaveJeanSkill() {
  const serverId = useSettingsTargetServerId()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      content: string
      name?: string | null
      description?: string | null
      backends?: string[] | null
      previousSlug?: string | null
    }): Promise<SaveSkillResult> =>
      await invokeForServer<SaveSkillResult>(serverId, 'save_jean_skill', {
        content: input.content,
        name: input.name ?? undefined,
        description: input.description ?? undefined,
        backends: input.backends ?? undefined,
        previousSlug: input.previousSlug ?? undefined,
      }),
    onSuccess: () => invalidateSkillQueries(queryClient, serverId),
  })
}

export function useDeleteJeanSkill() {
  const serverId = useSettingsTargetServerId()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      slug: string
      backends?: string[] | null
    }): Promise<string[]> =>
      await invokeForServer<string[]>(serverId, 'delete_jean_skill', {
        slug: input.slug,
        backends: input.backends ?? undefined,
      }),
    onSuccess: () => invalidateSkillQueries(queryClient, serverId),
  })
}
