import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
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
  list: () => [...jeanSkillKeys.all, 'list'] as const,
  backends: () => [...jeanSkillKeys.all, 'backends'] as const,
  document: (slug: string) => [...jeanSkillKeys.all, 'document', slug] as const,
}

export function useJeanSkills() {
  return useQuery({
    queryKey: jeanSkillKeys.list(),
    queryFn: async (): Promise<JeanSkill[]> => {
      if (!isTauri()) return []

      try {
        return await invoke<JeanSkill[]>('list_jean_skills')
      } catch (error) {
        logger.error('Failed to load skills', { error })
        return []
      }
    },
    staleTime: 1000 * 30,
  })
}

export function useSkillBackends() {
  return useQuery({
    queryKey: jeanSkillKeys.backends(),
    queryFn: async (): Promise<SkillBackendTarget[]> => {
      if (!isTauri()) return []

      try {
        return await invoke<SkillBackendTarget[]>('list_skill_backends')
      } catch (error) {
        logger.error('Failed to load skill backends', { error })
        return []
      }
    },
    staleTime: 1000 * 60 * 5,
  })
}

export function useReadJeanSkill(slug: string | null) {
  return useQuery({
    queryKey: jeanSkillKeys.document(slug ?? ''),
    enabled: Boolean(slug) && isTauri(),
    queryFn: async (): Promise<JeanSkillDocument | null> => {
      if (!slug) return null
      return await invoke<JeanSkillDocument>('read_jean_skill', { slug })
    },
  })
}

/** Skill writes change what the slash-command picker can offer. */
function invalidateSkillQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: jeanSkillKeys.all })
  queryClient.invalidateQueries({ queryKey: skillQueryKeys.all })
}

export function useSaveJeanSkill() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      content: string
      name?: string | null
      description?: string | null
      backends?: string[] | null
      previousSlug?: string | null
    }): Promise<SaveSkillResult> =>
      await invoke<SaveSkillResult>('save_jean_skill', {
        content: input.content,
        name: input.name ?? undefined,
        description: input.description ?? undefined,
        backends: input.backends ?? undefined,
        previousSlug: input.previousSlug ?? undefined,
      }),
    onSuccess: () => invalidateSkillQueries(queryClient),
  })
}

export function useDeleteJeanSkill() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: {
      slug: string
      backends?: string[] | null
    }): Promise<string[]> =>
      await invoke<string[]>('delete_jean_skill', {
        slug: input.slug,
        backends: input.backends ?? undefined,
      }),
    onSuccess: () => invalidateSkillQueries(queryClient),
  })
}
