import { CLIENT_BUILD_INFO, CLIENT_WEB_BUILD_ID } from '@/lib/build-info'
import { isNativeApp } from '@/lib/environment'
import { logger } from '@/lib/logger'

interface ServerBuildInfo {
  webBuildId?: string | null
  appVersion?: string | null
}

let notifiedServerBuildId: string | null = null

/**
 * Detect browser-mode clients whose loaded JS bundle is older than the
 * frontend currently served by Jean Web Access.
 */
export function checkWebClientVersion(serverInfo: ServerBuildInfo): boolean {
  if (isNativeApp()) return false

  const serverBuildId = serverInfo.webBuildId
  if (!serverBuildId || serverBuildId === CLIENT_WEB_BUILD_ID) return false

  if (notifiedServerBuildId === serverBuildId) return true
  notifiedServerBuildId = serverBuildId

  logger.warn('Stale web access client detected', {
    clientBuildId: CLIENT_WEB_BUILD_ID,
    serverBuildId,
    clientVersion: CLIENT_BUILD_INFO.appVersion,
    serverVersion: serverInfo.appVersion,
  })

  return true
}
