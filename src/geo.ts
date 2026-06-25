import type { Bounds, LatLng } from './types'

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

function onSegment(a: LatLng, b: LatLng, c: LatLng): boolean {
  return b.lon >= Math.min(a.lon, c.lon) - 1e-12
    && b.lon <= Math.max(a.lon, c.lon) + 1e-12
    && b.lat >= Math.min(a.lat, c.lat) - 1e-12
    && b.lat <= Math.max(a.lat, c.lat) + 1e-12
}
