import React, { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2 } from 'lucide-react'
import { usePreferences, usePatchPreferences } from '@/services/preferences'
import { SettingsSection } from '../SettingsSection'

const InlineField: React.FC<{
  label: string
  description?: React.ReactNode
  children: React.ReactNode
}> = ({ label, description, children }) => (
  <div className="space-y-2">
    <div className="space-y-0.5">
      <Label className="text-sm text-foreground">{label}</Label>
      {description && (
        <div className="text-xs text-muted-foreground">{description}</div>
      )}
    </div>
    {children}
  </div>
)

export const IntegrationsPane: React.FC = () => {
  const { data: preferences } = usePreferences()
  const patchPreferences = usePatchPreferences()

  const [localLinearApiKey, setLocalLinearApiKey] = useState<string | null>(
    null
  )
  const [showLinearApiKey, setShowLinearApiKey] = useState(false)

  const currentGlobalKey = preferences?.linear_api_key ?? ''
  const displayedLinearApiKey = localLinearApiKey ?? currentGlobalKey
  const linearApiKeyChanged =
    localLinearApiKey !== null && localLinearApiKey !== currentGlobalKey

  const handleSaveLinearApiKey = () => {
    if (localLinearApiKey === null) return
    patchPreferences.mutate(
      { linear_api_key: localLinearApiKey.trim() || null },
      { onSuccess: () => setLocalLinearApiKey(null) }
    )
  }

  const handleClearLinearApiKey = () => {
    patchPreferences.mutate(
      { linear_api_key: null },
      { onSuccess: () => setLocalLinearApiKey(null) }
    )
  }

  const [localOutlineApiKey, setLocalOutlineApiKey] = useState<string | null>(
    null
  )
  const [showOutlineApiKey, setShowOutlineApiKey] = useState(false)
  const [localOutlineUrl, setLocalOutlineUrl] = useState<string | null>(null)

  const currentOutlineKey = preferences?.outline_api_key ?? ''
  const displayedOutlineApiKey = localOutlineApiKey ?? currentOutlineKey
  const outlineApiKeyChanged =
    localOutlineApiKey !== null && localOutlineApiKey !== currentOutlineKey

  const currentOutlineUrl = preferences?.outline_url ?? ''
  const displayedOutlineUrl = localOutlineUrl ?? currentOutlineUrl
  const outlineUrlChanged =
    localOutlineUrl !== null && localOutlineUrl !== currentOutlineUrl

  const handleSaveOutline = () => {
    const patch: {
      outline_api_key?: string | null
      outline_url?: string | null
    } = {}
    if (outlineApiKeyChanged) {
      patch.outline_api_key = (localOutlineApiKey ?? '').trim() || null
    }
    if (outlineUrlChanged) {
      patch.outline_url = (localOutlineUrl ?? '').trim().replace(/\/+$/, '') || null
    }
    if (Object.keys(patch).length === 0) return
    patchPreferences.mutate(patch, {
      onSuccess: () => {
        setLocalOutlineApiKey(null)
        setLocalOutlineUrl(null)
      },
    })
  }

  const handleClearOutlineKey = () => {
    patchPreferences.mutate(
      { outline_api_key: null },
      { onSuccess: () => setLocalOutlineApiKey(null) }
    )
  }

  const outlineDirty = outlineApiKeyChanged || outlineUrlChanged

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Linear"
        anchorId="pref-integrations-section-linear"
      >
        <InlineField
          label="Personal API Key"
          description={
            <>
              Your Linear personal API key, used by all projects unless
              overridden in project settings. Get one from{' '}
              <a
                href="https://linear.app/settings/api"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                Linear Settings
              </a>
            </>
          }
        >
          <div className="flex items-center gap-2">
            <Input
              type={showLinearApiKey ? 'text' : 'password'}
              placeholder="lin_api_..."
              value={displayedLinearApiKey}
              onChange={e => setLocalLinearApiKey(e.target.value)}
              className="flex-1 text-base md:text-sm font-mono"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowLinearApiKey(!showLinearApiKey)}
            >
              {showLinearApiKey ? 'Hide' : 'Show'}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleSaveLinearApiKey}
              disabled={!linearApiKeyChanged || patchPreferences.isPending}
            >
              {patchPreferences.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Save
            </Button>
            {currentGlobalKey && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearLinearApiKey}
                disabled={patchPreferences.isPending}
              >
                Remove
              </Button>
            )}
          </div>
        </InlineField>
      </SettingsSection>

      <SettingsSection
        title="Outline"
        anchorId="pref-integrations-section-outline"
      >
        <InlineField
          label="Instance URL"
          description="Your Outline instance base URL, e.g. https://docs.example.com (cloud: https://app.getoutline.com)."
        >
          <Input
            type="text"
            placeholder="https://docs.example.com"
            value={displayedOutlineUrl}
            onChange={e => setLocalOutlineUrl(e.target.value)}
            className="flex-1 text-base md:text-sm font-mono"
          />
        </InlineField>
        <InlineField
          label="API Token"
          description={
            <>
              Your Outline API token, used by all projects unless overridden in
              project settings. Create one in Outline under{' '}
              <span className="font-medium">Settings → API Keys</span>.
            </>
          }
        >
          <div className="flex items-center gap-2">
            <Input
              type={showOutlineApiKey ? 'text' : 'password'}
              placeholder="ol_api_..."
              value={displayedOutlineApiKey}
              onChange={e => setLocalOutlineApiKey(e.target.value)}
              className="flex-1 text-base md:text-sm font-mono"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowOutlineApiKey(!showOutlineApiKey)}
            >
              {showOutlineApiKey ? 'Hide' : 'Show'}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleSaveOutline}
              disabled={!outlineDirty || patchPreferences.isPending}
            >
              {patchPreferences.isPending && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Save
            </Button>
            {currentOutlineKey && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearOutlineKey}
                disabled={patchPreferences.isPending}
              >
                Remove
              </Button>
            )}
          </div>
        </InlineField>
      </SettingsSection>
    </div>
  )
}
