import { routePathForElevation } from './elevation'
import type { RouteResult } from './types'

export function routeToGpx(route: RouteResult): string {
  const path = routePathForElevation(route)
  const points = path.map((point) => `      <trkpt lat="${point.lat}" lon="${point.lon}"></trkpt>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="OSM Postman" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${escapeXml(route.name)}</name>
    <trkseg>
${points}
    </trkseg>
  </trk>
</gpx>
`
}

export function routeToGeoJson(route: RouteResult): string {
  const path = routePathForElevation(route)
  return JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          name: route.name,
          distance: route.distance,
          ...route.stats,
        },
        geometry: {
          type: 'LineString',
          coordinates: path.map((point) => [point.lon, point.lat]),
        },
      },
    ],
  }, null, 2)
}

export function downloadText(filename: string, text: string, type: string): void {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '&':
        return '&amp;'
      case "'":
        return '&apos;'
      default:
        return '&quot;'
    }
  })
}
