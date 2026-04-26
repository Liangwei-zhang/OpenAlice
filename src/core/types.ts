import type { Config, WebChannel } from './config.js'

export type { Config, WebChannel }

/**
 * Minimal plugin contract kept for lightweight local extensions.
 *
 * Research Lite does not expose the legacy full EngineContext because that
 * context pulled in broker, trading, cron, heartbeat, and connector types.
 */
export interface Plugin<TContext = unknown> {
  name: string
  start(ctx: TContext): Promise<void>
  stop(): Promise<void>
}

export interface ReconnectResult {
  success: boolean
  error?: string
  message?: string
}

/** A media attachment collected from tool results. */
export interface MediaAttachment {
  type: 'image'
  /** Absolute path to the file on disk. */
  path: string
}
