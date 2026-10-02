import React, { useCallback, useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { invoke } from '@/lib/transport'
import {
  useDeleteJeanSkill,
  useJeanSkills,
  useSaveJeanSkill,
  useSkillBackends,
} from '@/services/jean-skills'
import type { JeanSkillDocument } from '@/types/jean-skills'
import { SettingsSection } from '../SettingsSection'

interface EditorState {
  content: string
  name: string
  description: string
  backends: string[]
  /** Slug of the skill being edited; null for a new one. */
  previousSlug: string | null
}

const PLACEHOLDER = `---
name: My Skill
description: When to use this skill
---

# My Skill

Instructions for the agent...`

export const SkillsPane: React.FC = () => {
  const { data: skills = [], isLoading } = useJeanSkills()
  const { data: backends = [] } = useSkillBackends()
  const saveSkill = useSaveJeanSkill()
  const deleteSkill = useDeleteJeanSkill()
  const [editor, setEditor] = useState<EditorState | null>(null)

  const allBackendIds = useMemo(() => backends.map(b => b.id), [backends])
  const backendLabels = useMemo(
    () => new Map(backends.map(b => [b.id, b.label])),
    [backends]
  )

  const startNew = useCallback(() => {
    setEditor({
      content: '',
      name: '',
      description: '',
      backends: allBackendIds,
      previousSlug: null,
    })
  }, [allBackendIds])

  const startEdit = useCallback(async (slug: string) => {
    try {
      const document = await invoke<JeanSkillDocument>('read_jean_skill', {
        slug,
      })
      setEditor({
        content: document.content,
        name: document.name,
        description: document.description ?? '',
        backends: document.backends,
        previousSlug: document.slug,
      })
    } catch (error) {
      toast.error('Failed to open skill', { description: String(error) })
    }
  }, [])

  const toggleBackend = (id: string) => {
    if (!editor) return
    setEditor({
      ...editor,
      backends: editor.backends.includes(id)
        ? editor.backends.filter(backend => backend !== id)
        : [...editor.backends, id],
    })
  }

  const handleSave = () => {
    if (!editor || !editor.content.trim() || editor.backends.length === 0) return

    saveSkill.mutate(
      {
        content: editor.content,
        name: editor.name.trim() || null,
        description: editor.description.trim() || null,
        backends: editor.backends,
        previousSlug: editor.previousSlug,
      },
      {
        onSuccess: result => {
          const agents = result.installed
            .map(id => backendLabels.get(id) ?? id)
            .join(', ')
          toast.success(`Installed "${result.name}" for ${agents}`)
          for (const failure of result.failed) {
            toast.error(
              `${backendLabels.get(failure.backend) ?? failure.backend}: ${failure.error}`
            )
          }
          setEditor(null)
        },
        onError: error =>
          toast.error('Failed to save skill', { description: String(error) }),
      }
    )
  }

  const handleDelete = (slug: string, name: string) => {
    deleteSkill.mutate(
      { slug },
      {
        onSuccess: removed =>
          toast.success(`Removed "${name}" from ${removed.length} agents`),
        onError: error =>
          toast.error('Failed to remove skill', { description: String(error) }),
      }
    )
  }

  return (
    <div className="space-y-8">
      <SettingsSection
        title="Skills"
        description="Paste a SKILL.md and Jean installs it into every agent's skill directory. Skills show up in the chat slash-command picker and are loaded by each CLI directly."
        anchorId="pref-skills-section-skills"
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">
            Installed skills
            {skills.length > 0 && (
              <span className="ml-2 text-xs text-muted-foreground">
                {skills.length}
              </span>
            )}
          </p>
          {!editor && (
            <Button size="sm" onClick={startNew}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Add skill
            </Button>
          )}
        </div>

        {editor && (
          <div className="space-y-4 rounded-md border p-3">
            <div className="space-y-1.5">
              <Label htmlFor="skill-content">SKILL.md</Label>
              <Textarea
                id="skill-content"
                className="min-h-64 font-mono text-xs"
                placeholder={PLACEHOLDER}
                value={editor.content}
                onChange={event =>
                  setEditor({ ...editor, content: event.target.value })
                }
              />
              <p className="text-xs text-muted-foreground">
                Paste the whole file. Jean writes the frontmatter for you if it
                is missing.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="skill-name">Name</Label>
                <Input
                  id="skill-name"
                  placeholder="Taken from frontmatter"
                  value={editor.name}
                  onChange={event =>
                    setEditor({ ...editor, name: event.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="skill-description">Description</Label>
                <Input
                  id="skill-description"
                  placeholder="When the agent should use it"
                  value={editor.description}
                  onChange={event =>
                    setEditor({ ...editor, description: event.target.value })
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Install for</Label>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setEditor({ ...editor, backends: allBackendIds })
                    }
                  >
                    All
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditor({ ...editor, backends: [] })}
                  >
                    None
                  </Button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {backends.map(backend => (
                  <label
                    key={backend.id}
                    className="flex items-center gap-2 text-sm"
                    title={backend.dir}
                  >
                    <Checkbox
                      checked={editor.backends.includes(backend.id)}
                      onCheckedChange={() => toggleBackend(backend.id)}
                    />
                    <span>{backend.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditor(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={
                  !editor.content.trim() ||
                  editor.backends.length === 0 ||
                  saveSkill.isPending
                }
              >
                {saveSkill.isPending ? 'Installing…' : 'Install'}
              </Button>
            </div>
          </div>
        )}

        {!isLoading && skills.length === 0 && !editor && (
          <p className="text-xs text-muted-foreground">
            No skills installed yet.
          </p>
        )}

        {skills.map(skill => (
          <div
            key={skill.slug}
            className="flex items-start justify-between gap-3 rounded-md border px-3 py-2"
          >
            <div className="min-w-0 space-y-1">
              <p className="truncate text-sm font-medium">{skill.name}</p>
              {skill.description && (
                <p className="line-clamp-2 text-xs text-muted-foreground">
                  {skill.description}
                </p>
              )}
              <div className="flex flex-wrap gap-1">
                {skill.backends.map(backend => (
                  <Badge
                    key={backend}
                    variant="secondary"
                    className="text-[0.625rem]"
                  >
                    {backendLabels.get(backend) ?? backend}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Edit ${skill.name}`}
                onClick={() => void startEdit(skill.slug)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remove ${skill.name}`}
                onClick={() => handleDelete(skill.slug, skill.name)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </SettingsSection>

      <SettingsSection
        title="Skill directories"
        description="Where each agent reads user-global skills from. Project-level skills in .claude/skills or .agents/skills are picked up automatically and are not managed here."
        anchorId="pref-skills-section-directories"
      >
        {backends.map(backend => (
          <div
            key={backend.id}
            className="flex items-center justify-between gap-4 text-sm"
          >
            <span>{backend.label}</span>
            <code className="truncate text-xs text-muted-foreground">
              {backend.dir}
            </code>
          </div>
        ))}
      </SettingsSection>
    </div>
  )
}
