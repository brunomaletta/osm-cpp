const LOG_KEY = 'osm-postman-debug-log'
const MAX_LOG = 200
const LOADING_TIMEOUT_MS = 50_000
const DEV_LOG_ENDPOINT = '/__osm-postman/log'

let enabled = false
let loadingSince: number | undefined
let loadingWatchdog: number | undefined
let staleLoadingCheck: number | undefined
let logShipQueue: Promise<void> = Promise.resolve()
const ring: string[] = []

type LoadingTimeoutHandler = (snapshot: Record<string, unknown>) => void
type StaleLoadingHandler = (snapshot: Record<string, unknown>) => void
let onLoadingTimeout: LoadingTimeoutHandler | undefined
let onStaleLoading: StaleLoadingHandler | undefined

declare global {
  interface Window {
    __osmPostmanLogs?: () => string[]
    __osmPostmanDumpLogs?: () => void
    __osmPostmanClearLogs?: () => void
  }
}

export function initDebugLogging(): boolean {
  const params = new URLSearchParams(location.search)
  enabled = import.meta.env.DEV
    || params.has('debug')
    || localStorage.getItem('osm-postman-debug') === '1'
  restoreRing()
  window.__osmPostmanLogs = () => [...ring]
  window.__osmPostmanDumpLogs = () => {
    console.log(ring.join('\n'))
  }
  window.__osmPostmanClearLogs = () => {
    ring.length = 0
    sessionStorage.removeItem(LOG_KEY)
  }
  if (enabled) {
    console.info('[osm-postman] debug logging on — run __osmPostmanDumpLogs() to print the ring buffer')
  }
  return enabled
}

export function isDebugLoggingEnabled(): boolean {
  return enabled
}

export function setLoadingTimeoutHandler(handler: LoadingTimeoutHandler): void {
  onLoadingTimeout = handler
}

export function setStaleLoadingHandler(handler: StaleLoadingHandler): void {
  onStaleLoading = handler
}

export function debugLog(category: string, message: string, data?: Record<string, unknown>): void {
  const ts = new Date().toISOString().slice(11, 23)
  const line = data
    ? `[osm-postman ${ts}] ${category}: ${message} ${JSON.stringify(data)}`
    : `[osm-postman ${ts}] ${category}: ${message}`
  ring.push(line)
  if (ring.length > MAX_LOG) ring.shift()
  try {
    sessionStorage.setItem(LOG_KEY, JSON.stringify(ring))
  } catch {
    // Ignore quota errors.
  }
  if (enabled) {
    if (data) console.log(`[osm-postman ${ts}] ${category}: ${message}`, data)
    else console.log(`[osm-postman ${ts}] ${category}: ${message}`)
  }
  shipLogLine(line)
}

function shipLogLine(line: string): void {
  if (!import.meta.env.DEV) return
  logShipQueue = logShipQueue.then(async () => {
    try {
      await fetch(DEV_LOG_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: `${line}\n`,
        keepalive: true,
      })
    } catch {
      // Dev log sink unavailable (e.g. preview build).
    }
  })
}

export function getLoadingElapsedMs(): number {
  return loadingSince ? Date.now() - loadingSince : 0
}

export function noteLoadingStatus(message: string, snapshot: () => Record<string, unknown>): void {
  const isGraphLoad = message.includes('Loading graph') || message.includes('Waiting for OSM')
    || message.includes('Expanding graph')
    || message.includes('Refetching graph')

  if (isGraphLoad) {
    loadingSince = Date.now()
    if (loadingWatchdog !== undefined) window.clearInterval(loadingWatchdog)
    loadingWatchdog = window.setInterval(() => {
      if (loadingSince === undefined) return
      const elapsed = Date.now() - loadingSince
      const snap = snapshot()
      if (elapsed >= LOADING_TIMEOUT_MS) {
        debugLog('watchdog', 'loading timeout fired', { elapsed, ...snap })
        onLoadingTimeout?.(snap)
        if (loadingWatchdog !== undefined) {
          window.clearInterval(loadingWatchdog)
          loadingWatchdog = undefined
        }
        loadingSince = undefined
        return
      }
      debugLog('watchdog', `still loading after ${elapsed}ms`, snap)
    }, 3000)
    if (staleLoadingCheck !== undefined) window.clearInterval(staleLoadingCheck)
    staleLoadingCheck = window.setInterval(() => {
      if (loadingSince === undefined) return
      onStaleLoading?.(snapshot())
    }, 5000)
    return
  }

  if (loadingWatchdog !== undefined) {
    window.clearInterval(loadingWatchdog)
    loadingWatchdog = undefined
  }
  if (staleLoadingCheck !== undefined) {
    window.clearInterval(staleLoadingCheck)
    staleLoadingCheck = undefined
  }
  loadingSince = undefined
}

function restoreRing(): void {
  try {
    const raw = sessionStorage.getItem(LOG_KEY)
    if (!raw) return
    const saved = JSON.parse(raw) as string[]
    ring.push(...saved.slice(-MAX_LOG))
  } catch {
    // Ignore corrupt logs.
  }
}
