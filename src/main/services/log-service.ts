import electron from 'electron'
import log from 'electron-log/main'
import { basename, join } from 'node:path'

const electronRuntime: unknown = electron
const electronApp =
  typeof electronRuntime === 'object' && electronRuntime !== null && 'app' in electronRuntime
    ? (electronRuntime as { app: typeof import('electron').app }).app
    : null

const redactPathLikeText = (value: string): string => {
  const homePath = electronApp?.isReady() ? electronApp.getPath('home') : ''
  let redacted = homePath ? value.replaceAll(homePath, '~') : value
  redacted = redacted.replace(
    /(?:\/[^/\s]+){3,}|(?:[A-Za-z]:\\(?:[^\\\s]+\\){2,}[^\\\s]*)/g,
    (match) => `…/${basename(match)}`,
  )
  return redacted
}

const sanitize = (value: unknown): unknown => {
  if (typeof value === 'string') return redactPathLikeText(value)
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactPathLikeText(value.message),
      stack: value.stack ? redactPathLikeText(value.stack) : undefined,
    }
  }
  if (Array.isArray(value)) return value.map(sanitize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        sanitize(entry),
      ]),
    )
  }
  return value
}

export const initializeLogService = (): void => {
  if (!electronApp) throw new Error('日志服务只能在 Electron 主进程中初始化。')
  log.initialize()
  log.transports.file.resolvePathFn = () =>
    join(electronApp.getPath('logs'), 'support-pack-builder.log')
  log.transports.file.level = 'info'
  log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'warn'
}

export const appLog = {
  debug: (...values: unknown[]): void => log.debug(...values.map(sanitize)),
  info: (...values: unknown[]): void => log.info(...values.map(sanitize)),
  warn: (...values: unknown[]): void => log.warn(...values.map(sanitize)),
  error: (...values: unknown[]): void => log.error(...values.map(sanitize)),
}
