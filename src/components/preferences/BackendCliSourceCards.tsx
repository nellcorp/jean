import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

interface BackendCliSourceCardsProps {
  value: 'jean' | 'path'
  onValueChange: (value: 'jean' | 'path') => void
  backendName: string
  managedAction?: ReactNode
  managedDescription?: string
  path: string | null | undefined
  pathVersion?: string | null
  pathFound: boolean
}

export function BackendCliSourceCards({
  value,
  onValueChange,
  backendName,
  managedDescription,
  managedAction,
  path,
  pathVersion,
  pathFound,
}: BackendCliSourceCardsProps) {
  const sourceId = backendName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return (
    <RadioGroup
      value={value}
      onValueChange={next => {
        if (next === 'jean' || next === 'path') onValueChange(next)
      }}
      className="w-full gap-3"
    >
      <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center">
        <Label
          htmlFor={`${sourceId}-source-jean`}
          className="flex min-w-0 flex-1 cursor-pointer items-start gap-3"
        >
          <RadioGroupItem id={`${sourceId}-source-jean`} value="jean" />
          <span>
            <span className="block text-sm font-medium">Jean managed</span>
            <span className="block text-xs leading-relaxed text-muted-foreground">
              {managedDescription ??
                `Jean installs and updates an isolated ${backendName} version.`}
            </span>
          </span>
        </Label>
        {managedAction && (
          <div className="pl-7 sm:shrink-0 sm:pl-0">{managedAction}</div>
        )}
      </div>
      <Label
        htmlFor={`${sourceId}-source-path`}
        className="flex cursor-pointer items-start gap-3 rounded-lg border p-4"
      >
        <RadioGroupItem
          id={`${sourceId}-source-path`}
          value="path"
          disabled={!pathFound}
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium">System PATH</span>
          <span className="block break-all text-xs leading-relaxed text-muted-foreground">
            {pathFound
              ? `${path ?? `${backendName} on PATH`}${pathVersion ? ` · ${pathVersion}` : ''}`
              : `No ${backendName} was found on PATH.`}
          </span>
        </span>
      </Label>
    </RadioGroup>
  )
}
