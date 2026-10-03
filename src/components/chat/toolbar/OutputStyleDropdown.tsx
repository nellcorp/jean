import { useCallback, useMemo } from 'react'
import { Palette } from '@/components/icons/reicon'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { parseServerResourceKey } from '@/lib/server-resource'
import { cn } from '@/lib/utils'
import { compareVersions } from '@/lib/version-utils'
import {
  useClaudeOutputStyles,
  useInstallOutputStyle,
} from '@/services/output-styles'
import { DEFAULT_OUTPUT_STYLE } from '@/types/output-styles'
import type { ClaudeOutputStyle } from '@/types/output-styles'

interface OutputStyleDropdownProps {
  selectedOutputStyle: string | null
  worktreePath?: string | null
  worktreeId?: string | null
  cliVersion?: string | null
  disabled?: boolean
  onOutputStyleChange: (style: string | null) => void
  className?: string
  align?: 'start' | 'center' | 'end'
}

const SECTION_ORDER = ['Understand', 'Business', 'Terse', 'Fun']

function isUnavailable(style: ClaudeOutputStyle, cliVersion?: string | null) {
  if (!style.minCliVersion) return false
  if (!cliVersion) return false
  return compareVersions(cliVersion, style.minCliVersion) < 0
}

export function OutputStyleDropdown({
  selectedOutputStyle,
  worktreePath,
  worktreeId,
  cliVersion,
  disabled = false,
  onOutputStyleChange,
  className,
  align = 'start',
}: OutputStyleDropdownProps) {
  const serverId = worktreeId
    ? (parseServerResourceKey(worktreeId)?.serverId ?? 'local')
    : undefined
  const { data: styles = [] } = useClaudeOutputStyles(worktreePath, serverId)
  const installOutputStyle = useInstallOutputStyle(serverId)

  const { builtIns, custom, bundledByCategory } = useMemo(() => {
    const builtIns = styles.filter(style => style.source === 'built-in')
    const custom = styles.filter(
      style => style.source === 'user' || style.source === 'project'
    )
    const bundledByCategory = new Map<string, ClaudeOutputStyle[]>()
    for (const style of styles) {
      if (style.source !== 'bundled') continue
      const category = style.category ?? 'Other'
      const group = bundledByCategory.get(category) ?? []
      group.push(style)
      bundledByCategory.set(category, group)
    }
    return { builtIns, custom, bundledByCategory }
  }, [styles])

  const handleChange = useCallback(
    (value: string) => {
      if (value === DEFAULT_OUTPUT_STYLE) {
        onOutputStyleChange(null)
        return
      }

      // Bundled presets only exist on disk once installed; the CLI cannot
      // resolve them until then.
      const style = styles.find(candidate => candidate.name === value)
      if (style?.source === 'bundled' && !style.installed && style.slug) {
        installOutputStyle.mutate(
          { slug: style.slug },
          { onSuccess: () => onOutputStyleChange(value) }
        )
        return
      }

      onOutputStyleChange(value)
    },
    [installOutputStyle, onOutputStyleChange, styles]
  )

  const activeLabel = selectedOutputStyle ?? DEFAULT_OUTPUT_STYLE

  const renderItem = (style: ClaudeOutputStyle) => {
    const unavailable = isUnavailable(style, cliVersion)
    return (
      <DropdownMenuRadioItem
        key={`${style.source}:${style.name}`}
        value={style.name}
        disabled={unavailable}
      >
        <span className="truncate">{style.name}</span>
        <span className="ml-auto pl-4 truncate text-xs text-muted-foreground">
          {unavailable
            ? `Requires Claude Code ${style.minCliVersion}+`
            : (style.description ?? '')}
        </span>
      </DropdownMenuRadioItem>
    )
  }

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              className={cn(
                'flex h-8 items-center gap-1.5 px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground disabled:pointer-events-none disabled:opacity-50',
                className
              )}
            >
              <Palette className="h-3.5 w-3.5" />
              <span className="max-w-24 truncate">{activeLabel}</span>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          Output style — applies from your next message
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align={align} className="max-h-96 overflow-y-auto">
        <DropdownMenuRadioGroup
          value={activeLabel}
          onValueChange={handleChange}
        >
          <DropdownMenuRadioItem value={DEFAULT_OUTPUT_STYLE}>
            {DEFAULT_OUTPUT_STYLE}
            <span className="ml-auto pl-4 text-xs text-muted-foreground">
              No style
            </span>
          </DropdownMenuRadioItem>

          {builtIns.length > 0 && <DropdownMenuSeparator />}
          {builtIns.map(renderItem)}

          {custom.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Custom
              </DropdownMenuLabel>
              {custom.map(renderItem)}
            </>
          )}

          {SECTION_ORDER.filter(category =>
            bundledByCategory.has(category)
          ).map(category => (
            <div key={category}>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {category}
              </DropdownMenuLabel>
              {(bundledByCategory.get(category) ?? []).map(renderItem)}
            </div>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
