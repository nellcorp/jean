import { useQuery } from '@tanstack/react-query'
import { isNativeApp } from '@/lib/environment'
import { usePreferences } from './preferences'

export function useWebEditorUrl(): string | null {
  const { data: preferences } = usePreferences()
  const configuredUrl = preferences?.web_editor_url?.trim() || null
  const native = isNativeApp()
  const { data: bundledUrl } = useQuery({
    queryKey: ['bundled-web-editor', window.location.origin],
    queryFn: async ({ signal }) => {
      const response = await fetch('/code/', { signal })
      if (!response.ok) return null
      const html = await response.text()
      return html.includes('id="vscode-workbench-web-configuration"')
        ? '/code'
        : null
    },
    enabled: !native && !configuredUrl,
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
  return native ? null : configuredUrl || bundledUrl || null
}
