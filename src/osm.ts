import type { Bounds, TransportProfile } from './types'
import type { OsmElement } from './graph'

export type OverpassResponse = {
  elements: OsmElement[]
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

export async function fetchOsmGraph(
  bounds: Bounds,
  profile: TransportProfile,
  signal?: AbortSignal,
): Promise<OverpassResponse> {
  const query = buildOverpassQuery(bounds, profile)
  const cacheKey = `overpass:${profile}:${hashQuery(query)}`
  const cached = readCache(cacheKey)
  if (cached) return cached
  let lastError: unknown
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: new URLSearchParams({ data: query }),
        signal,
      })
      if (!response.ok) throw new Error(`Overpass returned ${response.status}`)
      const data = await response.json() as OverpassResponse
      writeCache(cacheKey, data)
      return data
    } catch (error) {
      if (signal?.aborted) throw error
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Could not fetch OSM data.')
}

export function buildOverpassQuery(bounds: Bounds, profile: TransportProfile): string {
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`
  const filters = profile === 'pedestrian' ? pedestrianFilters() : carFilters()
  return `
[out:json][timeout:35];
(
${filters.map((filter) => `  way${filter}(${bbox});`).join('\n')}
);
out body;
>;
out skel qt;
`
}

function pedestrianFilters(): string[] {
  return [
    '["highway"]["highway"!~"motorway|motorway_link|trunk|trunk_link"]["access"!~"private|no"]["foot"!~"no"]',
    '["highway"~"footway|path|pedestrian|steps|living_street|residential|service|track"]',
  ]
}

function carFilters(): string[] {
  return [
    '["highway"~"motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service"]["access"!~"private|no"]["motor_vehicle"!~"no"]["vehicle"!~"no"]',
  ]
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
