import { haversineMeters, polylineLength, edgeCollectionToPath } from './geo'
import type { LatLng, RouteResult, StreetGraph } from './types'

type ElevationSample = {
  gainM: number
  lossM: number
  coverage: number
}

const MIN_COVERAGE = 0.08
const DEM_ENDPOINT = 'https://api.opentopodata.org/v1/srtm30m'
const NEAREST_ELEVATION_METERS = 60

export function routePathForElevation(route: RouteResult): LatLng[] {
  if (route.path.length >= 2) return route.path
  if (route.edges.length > 0) return edgeCollectionToPath(route.edges)
  return []
}

export function elevationStatsForRoute(
  graph: StreetGraph,
  route: RouteResult,
): Record<string, string | number> {
  const path = routePathForElevation(route)
  if (path.length < 2) return {}
  const distanceM = route.distance > 0 ? route.distance : polylineLength(path)
  const points = path.length > 160 ? samplePath(path, 120) : path
  const fromGraph = measurePathElevation(points, buildGraphElevationLookup(graph))
  return formatElevationStats(fromGraph, distanceM)
}

export async function enrichElevationStats(
  graph: StreetGraph,
  route: RouteResult,
  signal?: AbortSignal,
): Promise<Record<string, string | number>> {
  const path = routePathForElevation(route)
  if (path.length < 2) return {}

  const distanceM = route.distance > 0 ? route.distance : polylineLength(path)
  const points = path.length > 160 ? samplePath(path, 120) : path
  const fromGraph = measurePathElevation(points, buildGraphElevationLookup(graph))
  const graphStats = formatElevationStats(fromGraph, distanceM)

  const samples = samplePath(path, 80)
  if (samples.length < 2) return graphStats

  try {
    const elevations = await fetchDemElevations(samples, signal)
    if (!elevations || elevations.length < 2) return graphStats

    const fromDem = measureSequentialElevations(elevations)
    const demStats = formatElevationStats(fromDem, distanceM)
    if (!Object.keys(demStats).length) return graphStats
    if (!Object.keys(graphStats).length) return demStats
    return fromDem.coverage >= fromGraph.coverage ? demStats : graphStats
  } catch {
    return graphStats
  }
}

export function parseDemElevationResults(
  payload: { results?: Array<{ elevation: number | null; location?: { lat: number; lng: number } }> },
): number[] {
  const elevations: number[] = []
  for (const result of payload.results ?? []) {
    elevations.push(result.elevation === null || !Number.isFinite(result.elevation) ? NaN : result.elevation)
  }
  return elevations
}

export function elevationGameScore(gainM: number, distanceM: number): number {
  if (gainM <= 0 || distanceM <= 0) return 0
  return Math.round(Math.sqrt(2 * gainM * distanceM) / 10)
}

export function elevationGameLabel(score: number): string {
  if (score < 8) return 'flat'
  if (score < 20) return 'rolling'
  if (score < 40) return 'hilly'
  return 'mountain'
}

function formatElevationStats(sample: ElevationSample, distanceM: number): Record<string, string | number> {
  if (sample.coverage < MIN_COVERAGE) return {}
  const score = elevationGameScore(sample.gainM, distanceM)
  const stats: Record<string, string | number> = {
    elevationGain: `${Math.round(sample.gainM)} m`,
    elevationLoss: `${Math.round(sample.lossM)} m`,
  }
  if (score > 0) stats.elevationGame = `${score} (${elevationGameLabel(score)})`
  return stats
}

function buildGraphElevationLookup(graph: StreetGraph): Map<string, number> {
  const lookup = new Map<string, number>()
  for (const node of graph.nodes) {
    if (node.ele === undefined || !Number.isFinite(node.ele)) continue
    lookup.set(locationKey(node), node.ele)
  }

  for (const edge of graph.edges) {
    const start = graph.nodes[edge.u]
    const end = graph.nodes[edge.v]
    if (start.ele === undefined || end.ele === undefined) continue
    const geometry = edge.geometry.length >= 2 ? edge.geometry : [start, end]
    const total = polylineLength(geometry)
    const steps = Math.max(2, Math.ceil(total / 20))
    for (let i = 1; i < geometry.length; i++) {
      const a = geometry[i - 1]
      const b = geometry[i]
      const segment = polylineLength([a, b])
      const segmentSteps = Math.max(1, Math.round((segment / Math.max(total, 1)) * steps))
      for (let step = 0; step <= segmentSteps; step++) {
        const t = step / segmentSteps
        const lat = a.lat + (b.lat - a.lat) * t
        const lon = a.lon + (b.lon - a.lon) * t
        const startEle = lookup.get(locationKey(a)) ?? start.ele
        const endEle = lookup.get(locationKey(b)) ?? end.ele
        if (startEle === undefined || endEle === undefined) continue
        const ele = startEle + (endEle - startEle) * t
        lookup.set(locationKey({ lat, lon }), ele)
      }
    }
  }

  return lookup
}

function measurePathElevation(path: LatLng[], lookup: Map<string, number>): ElevationSample {
  let gainM = 0
  let lossM = 0
  let measured = 0
  let prevEle: number | undefined

  for (const point of path) {
    const ele = lookup.get(locationKey(point)) ?? nearestElevation(point, lookup)
    if (ele === undefined) continue
    if (prevEle !== undefined) {
      const delta = ele - prevEle
      if (delta > 0) gainM += delta
      else lossM += -delta
      measured++
    }
    prevEle = ele
  }

  return {
    gainM,
    lossM,
    coverage: measured / Math.max(1, path.length - 1),
  }
}

function measureSequentialElevations(elevations: number[]): ElevationSample {
  let gainM = 0
  let lossM = 0
  let measured = 0
  let prevEle: number | undefined

  for (const ele of elevations) {
    if (!Number.isFinite(ele)) {
      prevEle = undefined
      continue
    }
    if (prevEle !== undefined) {
      const delta = ele - prevEle
      if (delta > 0) gainM += delta
      else lossM += -delta
      measured++
    }
    prevEle = ele
  }

  return {
    gainM,
    lossM,
    coverage: measured / Math.max(1, elevations.length - 1),
  }
}

function nearestElevation(point: LatLng, lookup: Map<string, number>): number | undefined {
  let best: number | undefined
  let bestDist = NEAREST_ELEVATION_METERS
  for (const [key, ele] of lookup) {
    const [lat, lon] = key.split(',').map(Number)
    const dist = haversineMeters(point, { lat, lon })
    if (dist < bestDist) {
      bestDist = dist
      best = ele
    }
  }
  return best
}

function samplePath(path: LatLng[], maxSamples: number): LatLng[] {
  if (path.length <= maxSamples) return path
  const stride = Math.ceil(path.length / maxSamples)
  const samples: LatLng[] = []
  for (let i = 0; i < path.length; i += stride) samples.push(path[i])
  if (samples.at(-1) !== path.at(-1)) samples.push(path[path.length - 1])
  return samples
}

async function fetchDemElevations(points: LatLng[], signal?: AbortSignal): Promise<number[] | undefined> {
  const elevations: number[] = []
  const chunkSize = 90
  for (let start = 0; start < points.length; start += chunkSize) {
    const chunk = points.slice(start, start + chunkSize)
    const locations = chunk.map((point) => `${point.lat},${point.lon}`).join('|')
    const response = await fetch(`${DEM_ENDPOINT}?locations=${encodeURIComponent(locations)}`, { signal })
    if (!response.ok) return undefined
    const payload = await response.json() as {
      status?: string
      results?: Array<{ elevation: number | null; location?: { lat: number; lng: number } }>
    }
    if (payload.status && payload.status !== 'OK') return undefined
    const chunkElevations = parseDemElevationResults(payload)
    if (chunkElevations.length !== chunk.length) return undefined
    elevations.push(...chunkElevations)
  }
  return elevations.length === points.length ? elevations : undefined
}

function locationKey(point: LatLng): string {
  return `${point.lat.toFixed(5)},${point.lon.toFixed(5)}`
}
