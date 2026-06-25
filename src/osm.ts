import type { Bounds, OsmFetchRegion, TransportProfile } from './types'
import type { OsmElement } from './graph'
import { abortAfter, combineAbortSignals } from './abortUtils'
import { asFetchRegion } from './geo'

export type OverpassResponse = {
  elements: OsmElement[]
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

const FETCH_TIMEOUT_MS = 40_000

export async function fetchOsmGraph(
  region: Bounds | OsmFetchRegion,
  profile: TransportProfile,
  signal?: AbortSignal,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<OverpassResponse> {
  const fetchRegion = asFetchRegion(region)
  const query = buildOverpassQuery(fetchRegion, profile)
  const cacheKey = `overpass:${profile}:${hashQuery(query)}`
  const cached = readCache(cacheKey)
  if (cached) return cached
  const timeoutSignal = abortAfter(timeoutMs, signal)
  const requestSignal = signal ? combineAbortSignals([signal, timeoutSignal]) : timeoutSignal
  const started = Date.now()
  const perEndpointMs = Math.max(6_000, Math.floor(timeoutMs / OVERPASS_ENDPOINTS.length))
  let lastError: unknown
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const endpointStarted = Date.now()
    const remainingMs = timeoutMs - (endpointStarted - started)
    if (remainingMs < 500) break
    const endpointTimeoutMs = Math.min(perEndpointMs, remainingMs)
    const endpointTimeout = abortAfter(endpointTimeoutMs, requestSignal)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({ data: query }),
        signal: endpointTimeout,
      })
      if (!response.ok) throw new Error(`Overpass returned ${response.status}`)
      const data = await readJsonWithTimeout<OverpassResponse>(
        response,
        Math.min(15_000, endpointTimeoutMs),
        endpointTimeout,
      )
      writeCache(cacheKey, data)
      return data
    } catch (error) {
      if (signal?.aborted && Date.now() - started < timeoutMs - 250) throw error
      if (timeoutSignal.aborted || Date.now() - started >= timeoutMs - 250) {
        throw new Error('Graph fetch timed out. Try a smaller area or retry.')
      }
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not fetch OSM data.')
}

export function buildOverpassQuery(region: Bounds | OsmFetchRegion, profile: TransportProfile): string {
  const fetchRegion = asFetchRegion(region)
  const filter = profile === 'pedestrian' ? pedestrianFilter() : carFilter()
  if (fetchRegion.polygon && fetchRegion.polygon.length >= 3) {
    const poly = fetchRegion.polygon
      .map((point) => `${point.lat.toFixed(6)} ${point.lon.toFixed(6)}`)
      .join(' ')
    return `
[out:json][timeout:25];
way${filter}(poly:"${poly}");
out geom;
`
  }
  const bounds = fetchRegion.bounds
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`
  return `
[out:json][timeout:25];
way${filter}(${bbox});
out geom;
`
}

async function readJsonWithTimeout<T>(
  response: Response,
  ms: number,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Graph response parse timed out. Try again.')), ms)
  })
  const abort = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => {
      if (timer !== undefined) clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
  try {
    return await Promise.race([response.json() as Promise<T>, timeout, abort])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function pedestrianFilter(): string {
  return '["highway"]["highway"!~"motorway|motorway_link|trunk|trunk_link|bus_guideway|raceway|proposed|construction|abandoned"]["access"!~"private|no"]["foot"!~"no"]["area"!~"yes"]'
}

function carFilter(): string {
  return '["highway"~"motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service"]["access"!~"private|no"]["motor_vehicle"!~"no"]["vehicle"!~"no"]'
}

export function profileLabel(profile: TransportProfile): string {
  return profile === 'pedestrian' ? 'Pedestrian' : 'Car'
}

export function profileCaveat(profile: TransportProfile): string {
  if (profile === 'car') {
    return 'Car mode currently solves an undirected approximation; one-way handling is a planned upgrade.'
  }
  return 'Pedestrian mode includes walkable roads, paths, footways, and stairs when OSM tags allow them.'
}

function readCache(key: string): OverpassResponse | undefined {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return undefined
    const cached = JSON.parse(raw) as { at: number; data: OverpassResponse }
    if (Date.now() - cached.at > 1000 * 60 * 60 * 24 * 7) {
      localStorage.removeItem(key)
      return undefined
    }
    return cached.data
  } catch {
    return undefined
  }
}

function writeCache(key: string, data: OverpassResponse): void {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }))
  } catch {
    // Cache is opportunistic; ignore quota/private-mode failures.
  }
}

function hashQuery(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
