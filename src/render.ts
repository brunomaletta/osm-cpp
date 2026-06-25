import L from 'leaflet'
import type { LatLng, PointSelection, RouteResult, StreetGraph } from './types'
import { formatDistance } from './geo'

export type RenderController = {
  graphLayer: L.LayerGroup
  routeLayer: L.LayerGroup
  pointLayer: L.LayerGroup
  setGraph: (graph: StreetGraph | undefined) => void
  setRoute: (route: RouteResult | undefined) => void
  setPoints: (points: PointSelection[]) => void
  setProgress: (progress: number) => void
}

const RESULT_EDGE_COLOR = '#f97316'
const POSTMAN_BASE_COLOR = '#475569'
const GRAPH_EDGES_PER_LAYER = 250

export function createRenderController(
  map: L.Map,
  options: {
    onPointDragStart?: (id: string) => void
    onPointDragEnd?: (id: string, location: LatLng) => void
  } = {},
): RenderController {
  const graphLayer = L.layerGroup().addTo(map)
  const routeLayer = L.layerGroup().addTo(map)
  const heatLayer = L.layerGroup().addTo(map)
  const pointLayer = L.layerGroup().addTo(map)
  let routePath: LatLng[] = []
  let animatedLine: L.Polyline | undefined
  let currentRoute: RouteResult | undefined
  let postmanPlayback = false
  const graphCanvasRenderer = L.canvas({ padding: 0.5 })

  function setGraph(graph: StreetGraph | undefined) {
    graphLayer.clearLayers()
    if (!graph?.edges.length) return
    const lines: L.LatLngExpression[][] = []
    for (const edge of graph.edges) {
      if (edge.geometry.length < 2) continue
      lines.push(toLeaflet(edge.geometry))
    }
    if (!lines.length) return
    for (let i = 0; i < lines.length; i += GRAPH_EDGES_PER_LAYER) {
      L.polyline(lines.slice(i, i + GRAPH_EDGES_PER_LAYER), {
        color: '#94a3b8',
        opacity: 0.85,
        weight: 2.5,
        renderer: graphCanvasRenderer,
      }).addTo(graphLayer)
    }
  }

  function setRoute(route: RouteResult | undefined) {
    currentRoute = route
    drawRoute()
  }

  function drawRoute() {
    routeLayer.clearLayers()
    heatLayer.clearLayers()
    const route = currentRoute
    routePath = route?.path ?? []
    animatedLine = undefined
    postmanPlayback = route?.name === 'Chinese Postman'
    if (!route) return

    if (!postmanPlayback && route.highlights?.length) {
      for (const edge of route.highlights) {
        L.polyline(toLeaflet(edge.geometry), {
          color: RESULT_EDGE_COLOR,
          opacity: 0.98,
          weight: 6,
          lineCap: 'round',
        }).addTo(routeLayer)
      }
    }

    if (route.path.length === 0) return

    if (postmanPlayback) {
      L.polyline(toLeaflet(route.path), {
        color: POSTMAN_BASE_COLOR,
        opacity: 0.28,
        weight: 2,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(routeLayer)
      return
    }

    animatedLine = L.polyline([], {
      color: RESULT_EDGE_COLOR,
      opacity: 1,
      weight: 5,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(routeLayer)

    setProgress(1)
  }

  function setPoints(points: PointSelection[]) {
    pointLayer.clearLayers()
    for (const point of points) {
      if (point.snapDistance > 0.5) {
        L.polyline(toLeaflet([point.location, point.snappedLocation]), {
          color: RESULT_EDGE_COLOR,
          opacity: 0.95,
          weight: 4,
          dashArray: '8 7',
        }).addTo(pointLayer)
        L.circleMarker([point.snappedLocation.lat, point.snappedLocation.lon], {
          radius: 8,
          color: '#0f172a',
          weight: 3,
          fillColor: RESULT_EDGE_COLOR,
          fillOpacity: 0.95,
        }).bindTooltip(`${point.label} snapped to graph`, {
          direction: 'right',
          offset: [10, 0],
        }).addTo(pointLayer)
      }
      const marker = L.marker([point.location.lat, point.location.lon], {
        draggable: true,
        title: `Point ${point.label}`,
        icon: L.divIcon({
          className: 'point-handle',
          html: `<span>${point.label}</span>`,
          iconSize: [34, 34],
          iconAnchor: [17, 17],
        }),
      })
      marker.on('dragstart', () => {
        options.onPointDragStart?.(point.id)
      })
      marker.on('dragend', () => {
        const latlng = marker.getLatLng()
        options.onPointDragEnd?.(point.id, { lat: latlng.lat, lon: latlng.lng })
      })
      marker.addTo(pointLayer)
    }
  }

  function setProgress(progress: number) {
    if (!currentRoute || routePath.length === 0) return
    if (postmanPlayback) {
      heatLayer.clearLayers()
      drawPostmanHeat(heatLayer, routePath, progress)
      return
    }
    if (!animatedLine) return
    const count = Math.max(1, Math.floor(routePath.length * progress))
    animatedLine.setLatLngs(toLeaflet(routePath.slice(0, count)))
  }

  return { graphLayer, routeLayer, pointLayer, setGraph, setRoute, setPoints, setProgress }
}

function drawPostmanHeat(layer: L.LayerGroup, path: LatLng[], progress: number): void {
  if (path.length < 2) return

  const loopLength = path.length - 1
  const head = progress * loopLength
  const heatWindow = Math.max(120, loopLength * 0.45)
  const stride = loopLength > 1600 ? 4 : loopLength > 900 ? 3 : loopLength > 400 ? 2 : 1

  for (let start = 0; start < loopLength; start += stride) {
    const end = Math.min(loopLength, start + stride)
    const midIndex = (start + end - 1) / 2
    const distBehind = (head - midIndex + loopLength) % loopLength
    if (distBehind > heatWindow) continue

    const heat = 1 - distBehind / heatWindow
    if (heat <= 0.02) continue

    L.polyline(toLeaflet(path.slice(start, end + 1)), {
      color: heatColor(heat),
      opacity: heat * 0.92,
      weight: 1.5 + heat * 2.5,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(layer)
  }
}

function heatColor(heat: number): string {
  return lerpColor('#1d4ed8', '#dc2626', heat)
}

function lerpColor(a: string, b: string, t: number): string {
  const clamped = Math.max(0, Math.min(1, t))
  const ar = Number.parseInt(a.slice(1, 3), 16)
  const ag = Number.parseInt(a.slice(3, 5), 16)
  const ab = Number.parseInt(a.slice(5, 7), 16)
  const br = Number.parseInt(b.slice(1, 3), 16)
  const bg = Number.parseInt(b.slice(3, 5), 16)
  const bb = Number.parseInt(b.slice(5, 7), 16)
  const r = Math.round(ar + (br - ar) * clamped)
  const g = Math.round(ag + (bg - ag) * clamped)
  const bl = Math.round(ab + (bb - ab) * clamped)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`
}

export { edgeCollectionToPath } from './geo'

export function routeSummary(route: RouteResult): string {
  return `${route.name}: ${formatDistance(route.distance)}`
}

function toLeaflet(points: LatLng[]): L.LatLngExpression[] {
  return points.map((point) => [point.lat, point.lon])
}
