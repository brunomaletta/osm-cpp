import type { Bounds, GraphEdge, LatLng, OsmFetchRegion } from './types'

const EARTH_RADIUS_M = 6371008.8

export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = Math.PI / 180
  const dLat = (b.lat - a.lat) * toRad
  const dLon = (b.lon - a.lon) * toRad
  const lat1 = a.lat * toRad
  const lat2 = b.lat * toRad
  const sinLat = Math.sin(dLat / 2)
  const sinLon = Math.sin(dLon / 2)
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function polylineLength(points: LatLng[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += haversineMeters(points[i - 1], points[i])
  return total
}

export function boundsFromCenter(center: LatLng, radiusMeters: number): Bounds {
  const latDelta = (radiusMeters / EARTH_RADIUS_M) * (180 / Math.PI)
  const lonDelta = latDelta / Math.max(0.15, Math.cos(center.lat * Math.PI / 180))
  return {
    south: center.lat - latDelta,
    west: center.lon - lonDelta,
    north: center.lat + latDelta,
    east: center.lon + lonDelta,
  }
}

export function normalizeBounds(a: LatLng, b: LatLng): Bounds {
  return {
    south: Math.min(a.lat, b.lat),
    west: Math.min(a.lon, b.lon),
    north: Math.max(a.lat, b.lat),
    east: Math.max(a.lon, b.lon),
  }
}

export function boundsFromPoints(points: LatLng[]): Bounds {
  return points.reduce<Bounds>((bounds, point) => ({
    south: Math.min(bounds.south, point.lat),
    west: Math.min(bounds.west, point.lon),
    north: Math.max(bounds.north, point.lat),
    east: Math.max(bounds.east, point.lon),
  }), {
    south: Infinity,
    west: Infinity,
    north: -Infinity,
    east: -Infinity,
  })
}

export function unionBounds(a: Bounds, b: Bounds): Bounds {
  return {
    south: Math.min(a.south, b.south),
    west: Math.min(a.west, b.west),
    north: Math.max(a.north, b.north),
    east: Math.max(a.east, b.east),
  }
}

export function boundsSpanMeters(bounds: Bounds): number {
  return haversineMeters(
    { lat: bounds.south, lon: bounds.west },
    { lat: bounds.north, lon: bounds.east },
  )
}

export function boundsAroundSegment(a: LatLng, b: LatLng, halfWidthMeters: number): Bounds {
  const core = normalizeBounds(a, b)
  const latMid = (core.south + core.north) / 2
  const latPad = (halfWidthMeters / EARTH_RADIUS_M) * (180 / Math.PI)
  const lonPad = latPad / Math.max(0.15, Math.cos(latMid * Math.PI / 180))
  return {
    south: core.south - latPad,
    west: core.west - lonPad,
    north: core.north + latPad,
    east: core.east + lonPad,
  }
}

/** Split a long A→B corridor into several thin boxes (less empty area than one huge bbox). */
export function corridorBoundsChunks(
  a: LatLng,
  b: LatLng,
  halfWidthMeters: number,
  maxSpanMeters = 400,
): Bounds[] {
  const distance = haversineMeters(a, b)
  if (distance <= maxSpanMeters) return [boundsAroundSegment(a, b, halfWidthMeters)]
  const count = Math.ceil(distance / maxSpanMeters)
  const chunks: Bounds[] = []
  for (let i = 0; i < count; i++) {
    const t0 = i / count
    const t1 = (i + 1) / count
    const p0: LatLng = {
      lat: a.lat + (b.lat - a.lat) * t0,
      lon: a.lon + (b.lon - a.lon) * t0,
    }
    const p1: LatLng = {
      lat: a.lat + (b.lat - a.lat) * t1,
      lon: a.lon + (b.lon - a.lon) * t1,
    }
    chunks.push(boundsAroundSegment(p0, p1, halfWidthMeters))
  }
  return chunks
}

const HULL_MIN_AREA_SAVINGS = 0.06
const HULL_MAX_SPAN_METERS = 1000

export function centroid(points: LatLng[]): LatLng {
  const total = points.reduce(
    (sum, point) => ({ lat: sum.lat + point.lat, lon: sum.lon + point.lon }),
    { lat: 0, lon: 0 },
  )
  return { lat: total.lat / points.length, lon: total.lon / points.length }
}

export function convexHull(points: LatLng[]): LatLng[] {
  if (points.length <= 1) return [...points]
  const origin = centroid(points)
  const local = points.map((point) => ({ point, ...toLocalMeters(point, origin) }))
  local.sort((a, b) => a.x - b.x || a.y - b.y)
  const lower: typeof local = []
  for (const entry of local) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, entry) <= 0) lower.pop()
    lower.push(entry)
  }
  const upper: typeof local = []
  for (let i = local.length - 1; i >= 0; i--) {
    const entry = local[i]!
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, entry) <= 0) upper.pop()
    upper.push(entry)
  }
  upper.pop()
  lower.pop()
  return [...lower, ...upper].map((entry) => entry.point)
}

export function bufferConvexPolygon(ring: LatLng[], meters: number): LatLng[] {
  if (ring.length < 3 || meters <= 0) return [...ring]
  const origin = centroid(ring)
  let local = ring.map((point) => toLocalMeters(point, origin))
  if (signedArea(local) < 0) local = [...local].reverse()
  const offset = offsetConvexRing(local, meters)
  return offset.map((point) => fromLocalMeters(point, origin))
}

export function approxBoundsAreaSqMeters(bounds: Bounds): number {
  const centerLat = (bounds.south + bounds.north) / 2
  const height = haversineMeters({ lat: bounds.south, lon: centerLat }, { lat: bounds.north, lon: centerLat })
  const width = haversineMeters({ lat: centerLat, lon: bounds.west }, { lat: centerLat, lon: bounds.east })
  return height * width
}

export function approxPolygonAreaSqMeters(ring: LatLng[]): number {
  if (ring.length < 3) return 0
  const origin = ring[0]!
  const local = ring.map((point) => toLocalMeters(point, origin))
  let area = 0
  for (let i = 0; i < local.length; i++) {
    const j = (i + 1) % local.length
    area += local[i]!.x * local[j]!.y - local[j]!.x * local[i]!.y
  }
  return Math.abs(area) / 2
}

export function asFetchRegion(input: Bounds | OsmFetchRegion): OsmFetchRegion {
  return 'south' in input ? { bounds: input } : input
}

export function pointSetSpanMeters(points: LatLng[]): number {
  if (points.length < 2) return 0
  const [a, b] = farthestPair(points)
  return haversineMeters(a, b)
}

/** Long skinny layouts (e.g. A–B–C along a valley) where roads rarely follow a straight chord. */
export function isElongatedPointSet(points: LatLng[], minSpanMeters = 450): boolean {
  if (points.length < 2) return false
  const span = pointSetSpanMeters(points)
  if (span < minSpanMeters) return false
  const bounds = boundsFromPoints(points)
  const centerLat = (bounds.south + bounds.north) / 2
  const centerLon = (bounds.west + bounds.east) / 2
  const height = haversineMeters({ lat: bounds.south, lon: centerLon }, { lat: bounds.north, lon: centerLon })
  const width = haversineMeters({ lat: centerLat, lon: bounds.west }, { lat: centerLat, lon: bounds.east })
  const long = Math.max(height, width)
  const short = Math.max(Math.min(height, width), 30)
  return long / short >= 2
}

/** Widen bridge corridors so winding rural roads between two points stay inside the query. */
export function bridgeCorridorHalfWidth(a: LatLng, b: LatLng, paddingMeters: number): number {
  const span = haversineMeters(a, b)
  const extra = span > 450 ? Math.min(350, Math.round(span * 0.1)) : 0
  return paddingMeters + extra
}

export function bridgeFetchBounds(a: LatLng, b: LatLng, paddingMeters: number): Bounds {
  const span = haversineMeters(a, b)
  const halfWidth = bridgeCorridorHalfWidth(a, b, paddingMeters)
  if (span > 350) return boundsAroundSegment(a, b, halfWidth)
  return padBounds(boundsFromPoints([a, b]), Math.min(paddingMeters, 280))
}

/** Thin or widened corridor along the axis from first to last point (trails, valleys). */
export function elongatedCorridorRegion(points: LatLng[], paddingMeters: number): OsmFetchRegion {
  if (points.length < 2) {
    return { bounds: boundsFromCenter(points[0]!, paddingMeters) }
  }
  if (isCollinearSet(points)) {
    const [a, b] = farthestPair(points)
    return { bounds: boundsAroundSegment(a, b, paddingMeters) }
  }
  const ordered = orderPointsAlongAxis(points)
  const start = ordered[0]!
  const end = ordered[ordered.length - 1]!
  const halfWidth = bridgeCorridorHalfWidth(start, end, paddingMeters)
  return { bounds: boundsAroundSegment(start, end, halfWidth) }
}

/** Elongated corridors: per-point patches + bridges. Compact urban spreads use one bulk fetch. */
export function shouldPreferPatchBridgeLoad(points: LatLng[], minSpanMeters = 600): boolean {
  const span = pointSetSpanMeters(points)
  if (span <= minSpanMeters) return false
  if (!isElongatedPointSet(points, minSpanMeters)) return false
  // City-wide spreads (>8 km) need one bbox, not dozens of corridor chunks.
  if (span > 8_000) return false
  // Collinear trails are cheaper as one thin corridor bbox.
  if (isCollinearSet(points)) return false
  return true
}

export function orderPointsAlongAxis(points: LatLng[]): LatLng[] {
  if (points.length < 2) return [...points]
  const [a, b] = farthestPair(points)
  const origin = a
  const axis = toLocalMeters(b, origin)
  const len = Math.hypot(axis.x, axis.y) || 1
  const ux = axis.x / len
  const uy = axis.y / len
  return [...points].sort((left, right) => {
    const l = toLocalMeters(left, origin)
    const r = toLocalMeters(right, origin)
    return (l.x * ux + l.y * uy) - (r.x * ux + r.y * uy)
  })
}

/** Max snap distance that still counts as "covered" for a given search radius. */
export function snapCoverageLimitMeters(searchRadiusMeters: number, baseLimitMeters = 120): number {
  return Math.max(baseLimitMeters, Math.min(searchRadiusMeters, 400))
}

export function describeFetchRegionArea(region: Bounds | OsmFetchRegion): string {
  const fetchRegion = asFetchRegion(region)
  const areaSqM = fetchRegion.polygon?.length
    ? approxPolygonAreaSqMeters(fetchRegion.polygon)
    : approxBoundsAreaSqMeters(fetchRegion.bounds)
  const km2 = areaSqM / 1_000_000
  if (km2 < 0.01) return `${Math.round(areaSqM)} m²`
  if (km2 < 10) return `${km2.toFixed(2)} km²`
  return `${km2.toFixed(1)} km²`
}

/** Padded bbox, or convex hull + buffer when that cuts enough empty corners. */
export function fetchRegionFromPointSet(points: LatLng[], paddingMeters: number): OsmFetchRegion {
  if (!points.length) throw new Error('fetchRegionFromPointSet requires at least one point.')
  if (points.length === 1) {
    return { bounds: boundsFromCenter(points[0]!, paddingMeters) }
  }

  if (points.length === 2 || isCollinearSet(points)) {
    const [a, b] = farthestPair(points)
    return { bounds: boundsAroundSegment(a, b, paddingMeters) }
  }

  const paddedBbox = padBounds(boundsFromPoints(points), paddingMeters)
  const bboxArea = approxBoundsAreaSqMeters(paddedBbox)
  const hull = convexHull(points)
  if (hull.length < 3) {
    const [a, b] = farthestPair(points)
    return { bounds: boundsAroundSegment(a, b, paddingMeters) }
  }

  const buffered = bufferConvexPolygon(hull, paddingMeters)
  const hullArea = approxPolygonAreaSqMeters(buffered)
  const span = pointSetSpanMeters(points)
  if (
    span <= HULL_MAX_SPAN_METERS
    && hullArea > 0
    && hullArea < bboxArea * (1 - HULL_MIN_AREA_SAVINGS)
  ) {
    return { bounds: boundsFromPoints(buffered), polygon: buffered }
  }
  return { bounds: paddedBbox }
}

export function padBounds(bounds: Bounds, meters: number): Bounds {
  const center = {
    lat: (bounds.south + bounds.north) / 2,
    lon: (bounds.west + bounds.east) / 2,
  }
  const pad = boundsFromCenter(center, meters)
  return {
    south: bounds.south - (pad.north - center.lat),
    west: bounds.west - (pad.east - center.lon),
    north: bounds.north + (pad.north - center.lat),
    east: bounds.east + (pad.east - center.lon),
  }
}

export function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    const intersects = ((a.lat > point.lat) !== (b.lat > point.lat))
      && point.lon < ((b.lon - a.lon) * (point.lat - a.lat)) / (b.lat - a.lat || Number.EPSILON) + a.lon
    if (intersects) inside = !inside
  }
  return inside
}

export function isSimplePolygon(polygon: LatLng[]): boolean {
  if (polygon.length < 3) return false
  for (let i = 0; i < polygon.length; i++) {
    const a1 = polygon[i]
    const a2 = polygon[(i + 1) % polygon.length]
    for (let j = i + 1; j < polygon.length; j++) {
      const b1 = polygon[j]
      const b2 = polygon[(j + 1) % polygon.length]
      if (edgesAreAdjacent(i, j, polygon.length)) continue
      if (segmentsIntersect(a1, a2, b1, b2)) return false
    }
  }
  return true
}

export function midpoint(a: LatLng, b: LatLng): LatLng {
  return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 }
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return 'n/a'
  if (meters < 1000) return `${meters.toFixed(0)} m`
  return `${(meters / 1000).toFixed(2)} km`
}

function edgesAreAdjacent(i: number, j: number, n: number): boolean {
  return i === j || Math.abs(i - j) === 1 || (i === 0 && j === n - 1)
}

function segmentsIntersect(a: LatLng, b: LatLng, c: LatLng, d: LatLng): boolean {
  const o1 = orientation(a, b, c)
  const o2 = orientation(a, b, d)
  const o3 = orientation(c, d, a)
  const o4 = orientation(c, d, b)

  if (o1 === 0 && onSegment(a, c, b)) return true
  if (o2 === 0 && onSegment(a, d, b)) return true
  if (o3 === 0 && onSegment(c, a, d)) return true
  if (o4 === 0 && onSegment(c, b, d)) return true
  return o1 !== o2 && o3 !== o4
}

function orientation(a: LatLng, b: LatLng, c: LatLng): number {
  const value = (b.lon - a.lon) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lon - a.lon)
  if (Math.abs(value) < 1e-12) return 0
  return value > 0 ? 1 : -1
}

type LocalPoint = { x: number; y: number }

function toLocalMeters(point: LatLng, origin: LatLng): LocalPoint {
  const latRad = origin.lat * Math.PI / 180
  const scale = EARTH_RADIUS_M * Math.PI / 180
  return {
    x: (point.lon - origin.lon) * Math.cos(latRad) * scale,
    y: (point.lat - origin.lat) * scale,
  }
}

function fromLocalMeters(point: LocalPoint, origin: LatLng): LatLng {
  const latRad = origin.lat * Math.PI / 180
  const scale = EARTH_RADIUS_M * Math.PI / 180
  return {
    lat: origin.lat + point.y / scale,
    lon: origin.lon + point.x / (Math.cos(latRad) * scale),
  }
}

function cross(
  a: LocalPoint & { point?: LatLng },
  b: LocalPoint & { point?: LatLng },
  c: LocalPoint & { point?: LatLng },
): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function signedArea(ring: LocalPoint[]): number {
  let area = 0
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length
    area += ring[i]!.x * ring[j]!.y - ring[j]!.x * ring[i]!.y
  }
  return area / 2
}

function offsetConvexRing(ring: LocalPoint[], distance: number): LocalPoint[] {
  const n = ring.length
  const out: LocalPoint[] = []
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n]!
    const curr = ring[i]!
    const next = ring[(i + 1) % n]!
    const n1 = outwardNormal(prev, curr)
    const n2 = outwardNormal(curr, next)
    let bisX = n1.x + n2.x
    let bisY = n1.y + n2.y
    const bisLen = Math.hypot(bisX, bisY)
    if (bisLen < 1e-9) {
      bisX = n1.x
      bisY = n1.y
    } else {
      bisX /= bisLen
      bisY /= bisLen
    }
    const cosHalf = Math.max(Math.abs(n1.x * bisX + n1.y * bisY), 0.25)
    const scale = Math.min(distance / cosHalf, distance * 4)
    out.push({ x: curr.x + bisX * scale, y: curr.y + bisY * scale })
  }
  return out
}

function outwardNormal(a: LocalPoint, b: LocalPoint): LocalPoint {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  return { x: dy / len, y: -dx / len }
}

function farthestPair(points: LatLng[]): [LatLng, LatLng] {
  let best = 0
  let a = points[0]!
  let b = points[1] ?? points[0]!
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dist = haversineMeters(points[i]!, points[j]!)
      if (dist >= best) {
        best = dist
        a = points[i]!
        b = points[j]!
      }
    }
  }
  return [a, b]
}

function isCollinearSet(points: LatLng[], toleranceMeters = 40): boolean {
  if (points.length < 3) return points.length === 2
  const [a, b] = farthestPair(points)
  return points.every((point) => pointToSegmentDistanceMeters(point, a, b) <= toleranceMeters)
}

function pointToSegmentDistanceMeters(point: LatLng, a: LatLng, b: LatLng): number {
  const origin = a
  const p = toLocalMeters(point, origin)
  const start = toLocalMeters(a, origin)
  const end = toLocalMeters(b, origin)
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-6) return Math.hypot(p.x - start.x, p.y - start.y)
  const t = Math.max(0, Math.min(1, ((p.x - start.x) * dx + (p.y - start.y) * dy) / lenSq))
  const projX = start.x + t * dx
  const projY = start.y + t * dy
  return Math.hypot(p.x - projX, p.y - projY)
}

function onSegment(a: LatLng, b: LatLng, c: LatLng): boolean {
  return b.lon >= Math.min(a.lon, c.lon) - 1e-12
    && b.lon <= Math.max(a.lon, c.lon) + 1e-12
    && b.lat >= Math.min(a.lat, c.lat) - 1e-12
    && b.lat <= Math.max(a.lat, c.lat) + 1e-12
}

export function edgeCollectionToPath(edges: GraphEdge[]): LatLng[] {
  const path: LatLng[] = []
  for (const edge of edges) {
    if (path.length === 0) path.push(...edge.geometry)
    else path.push(...edge.geometry.slice(1))
  }
  return path
}
