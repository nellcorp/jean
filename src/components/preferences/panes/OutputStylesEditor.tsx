import React, { useMemo, useState } from 'react'
import { Download, Pencil, Plus, Trash2 } from '@/components/icons/reicon'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useSettingsTargetServerId } from '@/lib/settings-target'
import { invokeForServer } from '@/lib/transport'
import {
  useClaudeOutputStyles,
  useDeleteOutputStyle,
  useInstallOutputStyle,
  useSaveOutputStyle,
} from '@/services/output-styles'
import type {
  ClaudeOutputStyle,
  OutputStyleDocument,
  OutputStyleScope,
} from '@/types/output-styles'

const BUNDLED_CATEGORY_ORDER = ['Understand', 'Business', 'Terse', 'Fun']

interface EditorState {
  name: string
  description: string
  body: string
  keepCodingInstructions: boolean
  scope: OutputStyleScope
  /** Path of the style being edited, when replacing an existing file. */
  path: string | null
}

const EMPTY_EDITOR: EditorState = {
  name: '',
  description: '',
  body: '',
  keepCodingInstructions: true,
  scope: 'user',
  path: null,
}

export const OutputStylesEditor: React.FC = () => {
  const serverId = useSettingsTargetServerId()
  const { data: styles = [] } = useClaudeOutputStyles(null)
  const saveStyle = useSaveOutputStyle()
  const deleteStyle = useDeleteOutputStyle()
  const installStyle = useInstallOutputStyle()
  const [editor, setEditor] = useState<EditorState | null>(null)

  const { custom, bundledByCategory } = useMemo(() => {
    const custom = styles.filter(
      style => style.source === 'user' || style.source === 'project'
    )
    const bundledByCategory = new Map<string, ClaudeOutputStyle[]>()
    for (const style of styles) {
      if (style.source !== 'bundled') continue
      const category = style.category ?? 'Other'
      bundledByCategory.set(category, [
        ...(bundledByCategory.get(category) ?? []),
        style,
      ])
    }
    return { custom, bundledByCategory }
  }, [styles])

  const startEdit = async (style: ClaudeOutputStyle) => {
    if (!style.path) return
    try {
      const document = await invokeForServer<OutputStyleDocument>(
        serverId,
        'read_claude_output_style',
        { path: style.path }
      )
      setEditor({
        name: document.name,
        description: document.description ?? '',
        body: document.body,
        keepCodingInstructions: document.keepCodingInstructions ?? true,
        scope: style.source === 'project' ? 'project' : 'user',
        path: style.path,
      })
    } catch (error) {
      toast.error('Failed to open output style', { description: String(error) })
    }
  }

  const handleSave = () => {
    if (!editor || !editor.name.trim() || !editor.body.trim()) return
    saveStyle.mutate(
      {
        name: editor.name.trim(),
        description: editor.description.trim() || null,
        body: editor.body,
        keepCodingInstructions: editor.keepCodingInstructions,
        scope: editor.scope,
      },
      {
        onSuccess: () => {
          toast.success(`Saved "${editor.name.trim()}"`)
          setEditor(null)
        },
        onError: error =>
          toast.error('Failed to save output style', {
            description: String(error),
          }),
      }
    )
  }

  const handleDelete = (style: ClaudeOutputStyle) => {
    if (!style.path) return
    deleteStyle.mutate(
      { path: style.path },
      {
        onSuccess: () => toast.success(`Deleted "${style.name}"`),
        onError: error =>
          toast.error('Failed to delete output style', {
            description: String(error),
          }),
      }
    )
  }

  const handleInstall = (style: ClaudeOutputStyle) => {
    if (!style.slug) return
    installStyle.mutate(
      { slug: style.slug },
      {
        onSuccess: () => toast.success(`Installed "${style.name}"`),
        onError: error =>
          toast.error('Failed to install output style', {
            description: String(error),
          }),
      }
    )
  }

  const handleInstallAll = () => {
    for (const [, group] of bundledByCategory) {
      for (const style of group) {
        if (!style.installed && style.slug) {
          installStyle.mutate({ slug: style.slug })
        }
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Your styles</p>
          {!editor && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditor({ ...EMPTY_EDITOR })}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              New style
            </Button>
          )}
        </div>

        {custom.length === 0 && !editor && (
          <p className="text-xs text-muted-foreground">
            No custom styles yet. Write one, or install a preset below.
          </p>
        )}

        {custom.map(style => (
          <div
            key={style.path ?? style.name}
            className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{style.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {style.description ?? style.path}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Edit ${style.name}`}
                onClick={() => void startEdit(style)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Delete ${style.name}`}
                onClick={() => handleDelete(style)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {editor && (
        <div className="space-y-3 rounded-md border p-3">
          <Input
            placeholder="Name (shown in the picker)"
            value={editor.name}
            onChange={event =>
              setEditor({ ...editor, name: event.target.value })
            }
          />
          <Input
            placeholder="Description (optional)"
            value={editor.description}
            onChange={event =>
              setEditor({ ...editor, description: event.target.value })
            }
          />
          <Textarea
            className="min-h-48 font-mono text-xs"
            placeholder="Instructions for Claude (markdown)"
            value={editor.body}
            onChange={event =>
              setEditor({ ...editor, body: event.target.value })
            }
          />
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Keep coding instructions</p>
              <p className="text-xs text-muted-foreground">
                Keep Claude Code&apos;s software engineering instructions
                alongside your style
              </p>
            </div>
            <Switch
              checked={editor.keepCodingInstructions}
              onCheckedChange={checked =>
                setEditor({ ...editor, keepCodingInstructions: checked })
              }
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-medium">Scope</p>
            <Select
              value={editor.scope}
              onValueChange={value =>
                setEditor({ ...editor, scope: value as OutputStyleScope })
              }
            >
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="user">
                  User (~/.claude/output-styles)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditor(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!editor.name.trim() || !editor.body.trim()}
            >
              Save
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Presets</p>
            <p className="text-xs text-muted-foreground">
              Bundled from{' '}
              <span className="font-mono">
                smixs/awesome-claude-output-styles
              </span>{' '}
              (MIT). Installing writes the file to ~/.claude/output-styles.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={handleInstallAll}>
            Install all
          </Button>
        </div>

        {BUNDLED_CATEGORY_ORDER.filter(category =>
          bundledByCategory.has(category)
        ).map(category => (
          <div key={category} className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">
              {category}
            </p>
            {(bundledByCategory.get(category) ?? []).map(style => (
              <div
                key={style.slug ?? style.name}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{style.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {style.description}
                  </p>
                </div>
                {style.installed ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    Installed
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleInstall(style)}
                  >
                    <Download className="mr-1 h-3.5 w-3.5" />
                    Install
                  </Button>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
