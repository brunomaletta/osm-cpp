import 'leaflet/dist/leaflet.css'
import './style.css'
import L from 'leaflet'
import { addSnappedPoint, buildStreetGraph, clipGraphToPolygon, nearestPointOnGraph } from './graph'
import { boundsFromCenter, boundsFromPoints, isSimplePolygon, padBounds } from './geo'
import { solveChinesePostman } from './chinesePostman'
import { fetchOsmGraph, profileCaveat } from './osm'
import { createRenderController, routeSummary } from './render'
import { enrichElevationStats, elevationStatsForRoute, routePathForElevation } from './elevation'
import { downloadText, routeToGeoJson, routeToGpx } from './export'
import { installHoldDragBox } from './selection'
import { algorithmNeedsPoints, runPointAlgorithm, type PointAlgorithm } from './pointAlgorithms'
import {
  algorithmExactness,
  algorithmExceedsBudget,
  buildOperationCostContext,
  estimateAlgorithmOperations,
  formatOperations,
  formatAlgorithmComplexity,
  MAX_ESTIMATED_OPERATIONS,
  operationCostLevel,
  operationFillRatio,
  shouldShowApproximation,
  type OperationAlgorithm,
} from './operationCost'
import type {
  Bounds,
  LatLng,
  PointSelection,
  RouteResult,
  SavedExperiment,
  StreetGraph,
  TransportProfile,
} from './types'

type Algorithm = OperationAlgorithm
type InputMode = 'points' | 'polygon'

const algorithmTabLabels: Record<Algorithm, string> = {
  postman: 'Post',
  mst: 'MST',
  tsp: 'TSP',
  tspPath: 'Path',
  matching: 'Match',
  steiner: 'ST',
}


const algorithmInfo: Record<Algorithm, { title: string; complexity: string; approximation: string }> = {
  postman: {
    title: 'Chinese Postman',
    complexity: 'Dijkstra from each odd vertex + exact matching DP O(2^k k^2) + Hierholzer O(E).',
    approximation: 'Exact for undirected graphs; larger odd-vertex sets use the contorno Blossom-style matching fallback.',
  },
  mst: {
    title: 'MST over selected points',
    complexity: 'Dijkstra metric closure + Kruskal O(p^2 log p).',
    approximation: 'Exact MST over pairwise OSM shortest-path distances; this is a connector network, not an ordered route.',
  },
  tsp: {
    title: 'TSP Tour',
    complexity: 'Held-Karp O(p^2 2^p) for small p; nearest-neighbor + 2-opt for larger p.',
    approximation: 'Visits all selected points and returns to the chosen start. Exact for small p; larger mode is a heuristic with no formal guarantee.',
  },
  tspPath: {
    title: 'Open TSP Path',
    complexity: 'Held-Karp O(p^2 2^p) for small p; nearest-neighbor + 2-opt for larger p.',
    approximation: 'Visits all selected points from the chosen start without returning. Exact for small p; larger mode is a heuristic.',
  },
  matching: {
    title: 'Minimum Weighted Matching',
    complexity: 'Dijkstra metric closure, then weighted Blossom on the complete graph of selected points.',
    approximation: 'Exact minimum weighted matching using pairwise OSM shortest-path distances.',
  },
  steiner: {
    title: 'Steiner Tree',
    complexity: 'Exact DP + Dijkstra O(3^p n + 2^p m log m) for small p; metric-closure MST fallback for larger p.',
    approximation: 'Exact for small p; fallback is a 2-approximation style metric Steiner approach.',
  },
}

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <aside class="panel">
    <header class="panel-header">
      <p class="eyebrow">OSM graph playground</p>
      <h1>OSM Postman</h1>
    </header>

    <div class="panel-main">
    <section class="choice-section">
      <div>
        <h2>Profile</h2>
        <div id="profileChoices" class="choice-grid profile-grid compact-choice-grid">
          <button class="choice-card compact-choice active" data-profile="pedestrian" type="button" aria-pressed="true">
            <span class="choice-icon">WALK</span><strong>Walk</strong><small>Foot paths</small>
          </button>
          <button class="choice-card compact-choice" data-profile="car" type="button" aria-pressed="false">
            <span class="choice-icon">CAR</span><strong>Car</strong><small>Roads</small>
          </button>
        </div>
      </div>
      <div>
        <h2>Algorithm</h2>
        <div id="algorithmChoices" class="choice-grid algorithm-grid">
          <button class="choice-card cost-card active" data-algorithm="tspPath" type="button" aria-pressed="true">
            <span class="choice-icon">PATH</span>
            <strong class="choice-title">Open TSP</strong>
            <span class="choice-foot"><small class="choice-complexity">O(2^p)</small><span class="choice-badge"></span></span>
          </button>
          <button class="choice-card cost-card" data-algorithm="mst" type="button" aria-pressed="false">
            <span class="choice-icon">MST</span>
            <strong class="choice-title">MST</strong>
            <span class="choice-foot"><small class="choice-complexity">O(p²)</small><span class="choice-badge"></span></span>
          </button>
          <button class="choice-card cost-card" data-algorithm="tsp" type="button" aria-pressed="false">
            <span class="choice-icon">TSP</span>
            <strong class="choice-title">TSP</strong>
            <span class="choice-foot"><small class="choice-complexity">O(2^p)</small><span class="choice-badge"></span></span>
          </button>
          <button class="choice-card cost-card" data-algorithm="matching" type="button" aria-pressed="false">
            <span class="choice-icon">MWM</span>
            <strong class="choice-title">Match</strong>
            <span class="choice-foot"><small class="choice-complexity">O(p³)</small><span class="choice-badge"></span></span>
          </button>
          <button class="choice-card cost-card" data-algorithm="steiner" type="button" aria-pressed="false">
            <span class="choice-icon">ST</span>
            <strong class="choice-title">Steiner</strong>
            <span class="choice-foot"><small class="choice-complexity">O(3^p)</small><span class="choice-badge"></span></span>
          </button>
          <button class="choice-card cost-card" data-algorithm="postman" type="button" aria-pressed="false">
            <span class="choice-icon">CP</span>
            <strong class="choice-title">Postman</strong>
            <span class="choice-foot"><small class="choice-complexity">O(2^k)</small><span class="choice-badge"></span></span>
          </button>
        </div>
      </div>
      <div>
        <h2>Input</h2>
        <div id="inputChoices" class="choice-grid profile-grid">
          <button class="choice-card active" data-input-mode="points" type="button" aria-pressed="true">
            <span class="choice-icon">PTS</span><strong>Points</strong><small>Terminals</small>
          </button>
          <button class="choice-card" data-input-mode="polygon" type="button" aria-pressed="false">
            <span class="choice-icon">POLY</span><strong>Polygon</strong><small>Region</small>
          </button>
        </div>
      </div>
      <div class="choice-actions">
        <div class="compound-clear">
          <button id="clearSelection" class="compound-clear-main" type="button">Clear selection</button>
          <button id="clearGraph" class="danger compound-clear-sub" type="button">Clear graph</button>
        </div>
      </div>
      <label>Radius <span id="radiusLabel">350 m</span>
        <input id="radius" type="range" min="120" max="900" value="350" step="10" />
      </label>
    </section>
    </div>
    <footer class="panel-status" data-tone="idle" aria-live="polite">
      <p class="panel-status-label">Status</p>
      <p id="status" data-tone="idle">Click map to load. Shift+drag for region.</p>
    </footer>
  </aside>
  <main class="map-shell">
    <div id="map"></div>
    <aside class="stats-fixed map-fixed-panel" aria-live="polite">
      <p class="map-fixed-label">Stats</p>
      <dl id="stats"></dl>
    </aside>
    <aside class="edge-dock" aria-label="Map panels">
      <details class="edge-drawer" id="actionsPanel">
        <summary class="edge-tab">Act</summary>
        <div class="edge-panel edge-panel-actions">
          <h2 class="edge-panel-title">Actions</h2>
          <div class="button-row edge-panel-actions-play">
            <button id="play" class="secondary">Play</button>
          </div>
          <div class="button-row">
            <button id="gpx" class="secondary">GPX</button>
            <button id="geojson" class="secondary">GeoJSON</button>
          </div>
          <div class="button-row">
            <button id="saveExperiment" class="secondary">Save</button>
            <button id="loadExperiment" class="secondary">Load</button>
          </div>
          <div class="button-row edge-panel-actions-full">
            <button id="shareUrl" class="secondary">Share URL</button>
          </div>
          <div class="button-row edge-panel-actions-last">
            <button id="exportPoints" class="secondary">Export pts</button>
            <button id="importPoints" class="secondary">Import pts</button>
          </div>
          <input id="progress" type="range" min="0" max="1" value="1" step="0.001" hidden />
        </div>
      </details>
      <details class="edge-drawer" id="pointsPanel">
        <summary class="edge-tab"><span id="pointsPanelSummary">Pts</span></summary>
        <div class="edge-panel">
          <h2 class="edge-panel-title">Points</h2>
          <div id="pointList" class="point-list"></div>
        </div>
      </details>
      <details class="edge-drawer" id="algorithmPanel">
        <summary class="edge-tab"><span id="algorithmTabLabel">Info</span></summary>
        <div class="edge-panel side-panel-info">
          <h2 class="edge-panel-title" id="infoTitle">Open TSP Path</h2>
          <p><strong>Complexity:</strong> <span id="complexity"></span></p>
          <p><strong>Est. operations:</strong> <span id="operationCost">—</span> <span class="muted cost-budget-note">(~5M ≈ 2s)</span></p>
          <p><strong>Guarantee:</strong> <span id="approximation"></span></p>
          <p class="muted" id="profileCaveat"></p>
        </div>
      </details>
    </aside>
  </main>
`

let graph: StreetGraph | undefined
let route: RouteResult | undefined
let selectedPoints: PointSelection[] = []
let tspStartPointId: string | undefined
let lastBounds: Bounds | undefined
type RadiusBoundsSource = 'center' | 'points' | 'fixed'
let radiusBoundsSource: RadiusBoundsSource = 'fixed'
let radiusBoundsCenter: LatLng | undefined
let radiusReloadTimer: number | undefined
let polygonPoints: LatLng[] = []
let polygonDragging = false
let suppressNextMapClick = false
let movingPointId: string | undefined
let selectedAlgorithm: Algorithm = 'tspPath'
let selectedProfile: TransportProfile = 'pedestrian'
let selectedInputMode: InputMode = 'points'
let progress = 1
let playing = false
let animationFrame = 0
let graphLoadSerial = 0
let algorithmWorkSerial = 0
let activeGraphLoadController: AbortController | undefined
let pendingRerunTimer: number | undefined
const pendingPointFinalizations: Array<{ id: string; location: LatLng }> = []
let drainingPointFinalizations = false
let graphExpansionChain: Promise<unknown> = Promise.resolve()
const SNAP_RELOAD_DISTANCE_METERS = 120

const map = L.map('map', {
  doubleClickZoom: false,
  scrollWheelZoom: true,
  wheelDebounceTime: 90,
  wheelPxPerZoomLevel: 180,
  zoomControl: false,
}).setView([-19.9245, -43.9352], 14)
L.control.zoom({ position: 'bottomright' }).addTo(map)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 20,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map)

const renderer = createRenderController(map, {
  onPointDragStart: () => {
    clearCurrentAlgorithmResult()
  },
  onPointDragEnd: (id, location) => {
    void movePoint(id, location)
  },
})
map.createPane('polygonOverlay')
map.createPane('optimisticOverlay')
const polygonPane = map.getPane('polygonOverlay')
const optimisticPane = map.getPane('optimisticOverlay')
if (polygonPane) polygonPane.style.zIndex = '640'
if (optimisticPane) optimisticPane.style.zIndex = '650'
const polygonLayer = L.layerGroup().addTo(map)
const optimisticPointLayer = L.layerGroup().addTo(map)
const algorithmChoices = byId<HTMLElement>('algorithmChoices')
const profileChoices = byId<HTMLElement>('profileChoices')
const inputChoices = byId<HTMLElement>('inputChoices')
const radiusInput = byId<HTMLInputElement>('radius')
const radiusLabel = byId<HTMLSpanElement>('radiusLabel')
const statusEl = byId<HTMLParagraphElement>('status')
const statsEl = byId<HTMLElement>('stats')
const pointListEl = byId<HTMLElement>('pointList')
const progressInput = byId<HTMLInputElement>('progress')

type GraphLoadToken = {
  id: number
  signal: AbortSignal
}

type AlgorithmWorkToken = {
  id: number
}

type PointCoverageResult = {
  ok: boolean
  reloaded: boolean
  aborted?: boolean
}

installHoldDragBox(map, async (bounds) => {
  radiusBoundsSource = 'fixed'
  radiusBoundsCenter = undefined
  lastBounds = bounds
  await loadGraph(bounds)
  if (currentAlgorithm() === 'postman') await runCurrentAlgorithm()
})

map.on('click', async (event: L.LeafletMouseEvent) => {
  if (suppressNextMapClick) {
    suppressNextMapClick = false
    return
  }
  const point = { lat: event.latlng.lat, lon: event.latlng.lng }
  if (polygonDragging) return
  if (selectedInputMode === 'polygon') {
    const pendingMarker = showOptimisticPolygonVertex(point, polygonPoints.length)
    polygonPoints = [...polygonPoints, point]
    renderPolygon()
    updateUrl()
    if (polygonPoints.length < 3) {
      setStatus(`Vertex ${polygonPoints.length}. Need ${3 - polygonPoints.length} more.`, 'warn')
    }
    requestAnimationFrame(() => pendingMarker.remove())
    scheduleSelectionRerun(true)
    return
  }
  if (selectedInputMode === 'points') {
    if (movingPointId) {
      void movePoint(movingPointId, point)
      return
    }
    const provisional = addProvisionalPoint(point)
    schedulePointFinalization(provisional.id, point)
    return
  }
  lastBounds = boundsFromCenter(point, radiusMeters())
  radiusBoundsSource = 'center'
  radiusBoundsCenter = point
  await loadGraph(lastBounds)
  await runCurrentAlgorithm()
})

algorithmChoices.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-algorithm]')
  if (!button || button.disabled) return
  void setAlgorithm(button.dataset.algorithm as Algorithm)
})
profileChoices.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-profile]')
  if (!button) return
  void setProfile(button.dataset.profile as TransportProfile)
})
inputChoices.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-input-mode]')
  if (!button) return
  setInputMode(button.dataset.inputMode as InputMode)
})
radiusInput.addEventListener('input', () => {
  radiusLabel.textContent = `${radiusMeters()} m`
  scheduleRadiusReload()
})
byId<HTMLButtonElement>('clearSelection').addEventListener('click', () => clearSelection())
byId<HTMLButtonElement>('clearGraph').addEventListener('click', () => clearLoadedGraph())
byId<HTMLButtonElement>('gpx').addEventListener('click', () => {
  if (route) downloadText('osm-postman.gpx', routeToGpx(route), 'application/gpx+xml')
})
byId<HTMLButtonElement>('geojson').addEventListener('click', () => {
  if (route) downloadText('osm-postman.geojson', routeToGeoJson(route), 'application/geo+json')
})
byId<HTMLButtonElement>('play').addEventListener('click', togglePlay)
byId<HTMLButtonElement>('saveExperiment').addEventListener('click', saveExperiment)
byId<HTMLButtonElement>('loadExperiment').addEventListener('click', () => void loadExperiment())
byId<HTMLButtonElement>('shareUrl').addEventListener('click', shareCurrentUrl)
byId<HTMLButtonElement>('exportPoints').addEventListener('click', exportPoints)
byId<HTMLButtonElement>('importPoints').addEventListener('click', () => void importPoints())
progressInput.addEventListener('input', () => {
  progress = Number(progressInput.value)
  renderer.setProgress(progress)
})

updateAlgorithmInfo()
installEdgeDock()
void restoreFromUrl()

function installEdgeDock(): void {
  document.querySelectorAll<HTMLDetailsElement>('.edge-drawer').forEach((drawer) => {
    drawer.addEventListener('toggle', () => {
      if (!drawer.open) return
      document.querySelectorAll<HTMLDetailsElement>('.edge-drawer').forEach((other) => {
        if (other !== drawer) other.open = false
      })
    })
  })
}

async function loadGraph(
  bounds: Bounds,
  restorePointLocations: LatLng[] = [],
  work?: GraphLoadToken,
  options: { preserveSelectedPoints?: boolean } = {},
): Promise<boolean> {
  const loadWork = work ?? beginGraphLoad()
  setStatus('Loading graph…', 'loading')
  let data
  try {
    data = await fetchOsmGraph(bounds, currentProfile(), loadWork.signal)
  } catch (error) {
    if (loadWork.signal.aborted) return false
    setStatus(error instanceof Error ? error.message : 'Graph load failed.', 'error')
    return false
  }
  if (!isCurrentGraphLoad(loadWork)) return false
  graph = buildStreetGraph(data.elements, currentProfile())
  if (polygonPoints.length >= 3 && selectedInputMode === 'polygon') {
    graph = clipGraphToPolygon(graph, polygonPoints)
  }
  if (!isCurrentGraphLoad(loadWork)) return false
  if (!options.preserveSelectedPoints) {
    selectedPoints = []
    if (restorePointLocations.length === 0) {
      renderer.setPoints(selectedPoints)
    }
  }
  renderer.setGraph(graph)
  route = undefined
  renderer.setRoute(undefined)
  if (!options.preserveSelectedPoints) {
    for (const point of restorePointLocations) addPoint(point, false)
  }
  updateStats({ vertices: graph.nodes.length, edges: graph.edges.length })
  updateUrl()
  if (polygonPoints.length) renderPolygon()
  updateOperationEstimates()
  setStatus(`Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`, 'success')
  return true
}

async function runCurrentAlgorithm(work = beginAlgorithmWork()): Promise<void> {
  if (!graph) {
    setStatus('Load a graph first.', 'warn')
    return
  }
  if (currentAlgorithm() === 'matching' && selectedPoints.length % 2 === 1) {
    clearCurrentAlgorithmResult()
    updateStats({
      selectedPoints: selectedPoints.length,
      neededForMatching: 'one more point',
    })
    setStatus('Matching needs an even point count.', 'warn')
    return
  }
  try {
    const algorithm = currentAlgorithm()
    setStatus(`Running ${algorithmInfo[algorithm].title}…`, 'loading')
    const nextRoute = algorithm === 'postman'
      ? solveChinesePostman(graph)
      : runPointAlgorithm(algorithm as PointAlgorithm, graph, selectedPoints, { tspStartPointId })
    if (!isCurrentAlgorithmWork(work)) return
    route = applyElevationStats(graph, nextRoute)
    renderer.setRoute(route)
    if (algorithm === 'postman') {
      startAutoPlayback()
    } else {
      stopAutoPlayback()
      progress = 1
      progressInput.value = '1'
      renderer.setProgress(1)
    }
    const displayStats = { ...route.stats }
    updateStats(displayStats)
    setStatus(routeSummary(route), 'success')
    updateResultInfo(route)
    updateUrl()
    void refreshElevationStats(work, graph, route)
  } catch (error) {
    if (!isCurrentAlgorithmWork(work)) return
    setStatus(error instanceof Error ? error.message : 'Algorithm failed.', 'error')
  }
}

function applyElevationStats(routeGraph: StreetGraph, result: RouteResult): RouteResult {
  if (routeGraph.profile !== 'pedestrian' || routePathForElevation(result).length < 2) return result
  const elevationStats = elevationStatsForRoute(routeGraph, result)
  return { ...result, stats: withElevationStats(result.stats, elevationStats) }
}

async function refreshElevationStats(work: AlgorithmWorkToken, routeGraph: StreetGraph, result: RouteResult): Promise<void> {
  if (routeGraph.profile !== 'pedestrian' || routePathForElevation(result).length < 2) return
  try {
    const elevationStats = await enrichElevationStats(routeGraph, result)
    if (!isCurrentAlgorithmWork(work)) return
    route = { ...result, stats: withElevationStats(result.stats, elevationStats) }
    updateStats(route.stats)
  } catch {
    if (!isCurrentAlgorithmWork(work)) return
  }
}

const ELEVATION_STAT_KEYS = ['elevationGain', 'elevationLoss', 'elevationGame'] as const

function stripElevationStats(stats: Record<string, string | number>): Record<string, string | number> {
  const next = { ...stats }
  for (const key of ELEVATION_STAT_KEYS) delete next[key]
  return next
}

function withElevationStats(
  base: Record<string, string | number>,
  elevationStats: Record<string, string | number>,
): Record<string, string | number> {
  const stats = stripElevationStats(base)
  if (elevationStats.elevationGain !== undefined) Object.assign(stats, elevationStats)
  return stats
}

function addProvisionalPoint(location: LatLng): PointSelection {
  clearRouteResult()
  const point: PointSelection = {
    id: crypto.randomUUID(),
    label: pointLabel(selectedPoints.length),
    location,
    snappedLocation: location,
    snappedNode: -1,
    snapDistance: 0,
  }
  selectedPoints = [...selectedPoints, point]
  renderer.setPoints(selectedPoints)
  renderPointList()
  updateUrl()
  return point
}

async function finalizePendingPoints(batch: Array<{ id: string; location: LatLng }>): Promise<void> {
  const pending = batch.filter((next) => selectedPoints.some((point) => point.id === next.id))
  if (!pending.length) return

  const coverage = await ensureGraphCoversPoints()
  if (!coverage.ok) {
    if (coverage.aborted) {
      pendingPointFinalizations.unshift(...pending)
      await new Promise((resolve) => window.setTimeout(resolve, 100))
      return
    }
    const removed = new Set(pending.map((point) => point.id))
    selectedPoints = selectedPoints.filter((point) => !removed.has(point.id))
    renderer.setPoints(selectedPoints)
    renderPointList()
    updateUrl()
    setStatus('Could not load graph for points.', 'error')
    return
  }
  if (!graph) return

  const locations = new Map(pending.map((point) => [point.id, point.location]))
  if (!coverage.reloaded) {
    let workingGraph = graph
    selectedPoints = selectedPoints.map((point) => {
      const location = locations.get(point.id)
      if (!location) return point
      const snap = addSnappedPoint(workingGraph, location)
      workingGraph = snap.graph
      return {
        ...point,
        location,
        snappedLocation: snap.location,
        snappedNode: snap.nodeId,
        snapDistance: snap.distance,
      }
    })
    graph = workingGraph
  }
  renderer.setGraph(graph)
  renderer.setPoints(selectedPoints)
  renderPointList()
  updateUrl()
  const last = selectedPoints[selectedPoints.length - 1]
  setStatus(last ? `Point ${last.label} (${selectedPoints.length})` : `Points: ${selectedPoints.length}`, 'success')
  scheduleSelectionRerun()
}

async function drainPointFinalizations(): Promise<void> {
  if (drainingPointFinalizations) return
  drainingPointFinalizations = true
  try {
    while (pendingPointFinalizations.length) {
      const batch = pendingPointFinalizations.splice(0, pendingPointFinalizations.length)
      await finalizePendingPoints(batch)
    }
  } finally {
    drainingPointFinalizations = false
    if (pendingPointFinalizations.length) void drainPointFinalizations()
  }
}

function addPoint(location: LatLng, rerun = true): void {
  if (!graph) return
  const snap = addSnappedPoint(graph, location)
  graph = snap.graph
  const point: PointSelection = {
    id: crypto.randomUUID(),
    label: pointLabel(selectedPoints.length),
    location,
    snappedLocation: snap.location,
    snappedNode: snap.nodeId,
    snapDistance: snap.distance,
  }
  selectedPoints = [...selectedPoints, point]
  renderer.setGraph(graph)
  renderer.setPoints(selectedPoints)
  renderPointList()
  updateUrl()
  setStatus(`Point ${point.label} (${selectedPoints.length})`, 'success')
  if (rerun) scheduleSelectionRerun()
}

function showOptimisticPolygonVertex(location: LatLng, index: number): L.Marker {
  return L.marker([location.lat, location.lon], {
    interactive: false,
    pane: 'optimisticOverlay',
    icon: L.divIcon({
      className: 'polygon-handle polygon-handle-pending',
      html: `<span>${index + 1}</span>`,
      iconSize: [38, 38],
      iconAnchor: [19, 19],
    }),
  }).addTo(optimisticPointLayer)
}

async function movePoint(id: string, location: LatLng): Promise<void> {
  const index = selectedPoints.findIndex((point) => point.id === id)
  if (index === -1) return
  const previousPoints = selectedPoints.map((point) => ({ ...point }))
  selectedPoints = selectedPoints.map((point, pointIndex) => (
    pointIndex === index
      ? { ...point, location, snappedLocation: location, snappedNode: -1, snapDistance: 0 }
      : point
  ))
  renderer.setPoints(selectedPoints)
  movingPointId = undefined

  const coverage = await ensureGraphCoversPoints()
  if (!coverage.ok) {
    if (coverage.aborted) return
    selectedPoints = previousPoints
    renderer.setPoints(selectedPoints)
    renderPointList()
    setStatus('Could not load graph for point.', 'error')
    return
  }
  if (!graph) return
  if (!coverage.reloaded) {
    const snap = addSnappedPoint(graph, location)
    graph = snap.graph
    selectedPoints[index] = {
      ...selectedPoints[index],
      location,
      snappedLocation: snap.location,
      snappedNode: snap.nodeId,
      snapDistance: snap.distance,
    }
    renderer.setGraph(graph)
    renderer.setPoints(selectedPoints)
  } else {
    renderer.setGraph(graph)
    renderer.setPoints(selectedPoints)
  }
  renderPointList()
  updateUrl()
  setStatus(`Moved ${selectedPoints[index].label}`, 'success')
  scheduleSelectionRerun()
}

function updateAlgorithmInfo(): void {
  const info = algorithmInfo[currentAlgorithm()]
  const context = buildOperationCostContext(graph, selectedPoints.length)
  const exactness = algorithmExactness(currentAlgorithm(), context)
  const showApprox = shouldShowApproximation(currentAlgorithm(), context, graph !== undefined)
  byId('infoTitle').textContent = info.title
  byId('algorithmTabLabel').textContent = algorithmTabLabels[currentAlgorithm()]
  byId('complexity').textContent = info.complexity
  const approxEl = byId('approximation')
  approxEl.textContent = showApprox ? exactness.detail : info.approximation
  approxEl.classList.toggle('approx-label', showApprox)
  byId('profileCaveat').textContent = profileCaveat(currentProfile())
  updateOperationEstimates()
}

function updateResultInfo(result: RouteResult): void {
  byId('infoTitle').textContent = result.name
  byId('algorithmTabLabel').textContent = algorithmTabLabels[currentAlgorithm()]
  byId('complexity').textContent = result.complexity
  const approxEl = byId('approximation')
  approxEl.textContent = result.approximation
  const context = buildOperationCostContext(graph, selectedPoints.length)
  const showApprox = shouldShowApproximation(currentAlgorithm(), context, graph !== undefined)
    || /heuristic|fallback|approximation/i.test(`${result.complexity} ${result.approximation}`)
  approxEl.classList.toggle('approx-label', showApprox)
}

function updateStats(stats: Record<string, string | number>): void {
  const loadedStats = graph
    ? { loadedVertices: graph.nodes.length, loadedEdges: graph.edges.length }
    : {}
  statsEl.innerHTML = Object.entries({ ...loadedStats, ...stats })
    .map(([key, value]) => `<div><dt>${humanize(key)}</dt><dd>${String(value)}</dd></div>`)
    .join('')
}

function renderPointList(): void {
  const summary = byId<HTMLElement>('pointsPanelSummary')
  if (!selectedPoints.length) {
    pointListEl.innerHTML = '<p class="muted">No points selected.</p>'
    summary.textContent = 'Pts'
  } else {
    if (!selectedPoints.some((point) => point.id === tspStartPointId)) tspStartPointId = selectedPoints[0]?.id
    summary.textContent = String(selectedPoints.length)
    pointListEl.innerHTML = selectedPoints.map((point, index) => `
    <div class="point-row">
      <strong>${point.label}</strong>
      <span>${point.snapDistance.toFixed(1)} m snap</span>
      <button data-action="start" data-id="${point.id}" ${point.id === tspStartPointId ? 'disabled' : ''}>${point.id === tspStartPointId ? 'Start' : 'Set start'}</button>
      <button data-action="up" data-id="${point.id}" ${index === 0 ? 'disabled' : ''}>Up</button>
      <button data-action="down" data-id="${point.id}" ${index === selectedPoints.length - 1 ? 'disabled' : ''}>Down</button>
      <button data-action="move" data-id="${point.id}">Move</button>
      <button data-action="delete" data-id="${point.id}">Delete</button>
    </div>
  `).join('')
  }
  updateOperationEstimates()
}

pointListEl.addEventListener('click', (event) => {
  const target = event.target
  if (!(target instanceof HTMLButtonElement)) return
  const id = target.dataset.id
  const action = target.dataset.action
  if (!id || !action) return
  clearCurrentAlgorithmResult()
  if (action === 'start') {
    tspStartPointId = id
    renderPointList()
    updateUrl()
    void rerunAfterSelectionEdit()
    return
  }
  if (action === 'delete') selectedPoints = relabel(selectedPoints.filter((point) => point.id !== id))
  if (action === 'move') {
    movingPointId = id
    setStatus('Click map to place point.', 'warn')
    return
  }
  if (action === 'up' || action === 'down') {
    const index = selectedPoints.findIndex((point) => point.id === id)
    const delta = action === 'up' ? -1 : 1
    const next = index + delta
    if (index >= 0 && next >= 0 && next < selectedPoints.length) {
      const copy = [...selectedPoints]
      ;[copy[index], copy[next]] = [copy[next], copy[index]]
      selectedPoints = relabel(copy)
    }
  }
  renderer.setPoints(selectedPoints)
  renderPointList()
  updateUrl()
  void rerunAfterSelectionEdit()
})

async function rerunAfterSelectionEdit(): Promise<void> {
  if (pendingRerunTimer !== undefined) {
    window.clearTimeout(pendingRerunTimer)
    pendingRerunTimer = undefined
  }
  if (selectedInputMode === 'polygon') {
    if (polygonPoints.length < 3) {
      clearCurrentAlgorithmResult()
      setStatus(`Polygon: ${polygonPoints.length} verts. Need ${3 - polygonPoints.length} more.`, 'warn')
      return
    }
    if (!validatePolygonForRun()) return
    await reloadPolygonGraphAndRerun()
    return
  }

  if (selectedPoints.length < 2) {
    clearCurrentAlgorithmResult()
    setStatus(`Need ${2 - selectedPoints.length} more point${selectedPoints.length === 1 ? '' : 's'}.`, 'warn')
    return
  }
  if (currentAlgorithm() === 'matching' && selectedPoints.length % 2 === 1) {
    clearCurrentAlgorithmResult()
    updateStats({
      selectedPoints: selectedPoints.length,
      neededForMatching: 'one more point',
    })
    setStatus('Matching needs an even point count.', 'warn')
    return
  }
  await runCurrentAlgorithm()
}

function scheduleSelectionRerun(clearResult = false): void {
  if (pendingRerunTimer !== undefined) window.clearTimeout(pendingRerunTimer)
  pendingRerunTimer = window.setTimeout(() => {
    pendingRerunTimer = undefined
    if (clearResult) clearCurrentAlgorithmResult()
    void rerunAfterSelectionEdit()
  }, 0)
}

function schedulePointFinalization(pointId: string, location: LatLng): void {
  pendingPointFinalizations.push({ id: pointId, location })
  void drainPointFinalizations()
}

function graphCoversPoints(locations: LatLng[]): boolean {
  if (!graph || !lastBounds || !locations.length || !graph.edges.length) return false
  for (const point of locations) {
    if (!boundsContains(lastBounds, point)) return false
    if (nearestPointOnGraph(graph, point).distance > SNAP_RELOAD_DISTANCE_METERS) return false
  }
  return true
}

function resnapPointsOntoGraph(points: PointSelection[]): void {
  if (!graph?.edges.length) return
  let workingGraph = graph
  selectedPoints = points.map((point) => {
    const snap = addSnappedPoint(workingGraph, point.location)
    workingGraph = snap.graph
    return {
      ...point,
      snappedLocation: snap.location,
      snappedNode: snap.nodeId,
      snapDistance: snap.distance,
    }
  })
  graph = workingGraph
  renderer.setGraph(graph)
  renderer.setPoints(selectedPoints)
}

async function expandGraphForPoints(): Promise<boolean | 'aborted'> {
  const runExpansion = async (attempt = 0): Promise<boolean | 'aborted'> => {
    try {
      const tspStartId = tspStartPointId
      const locations = selectedPoints.map((point) => point.location)
      if (!locations.length) return graph !== undefined

      applyRadiusBoundsSource(locations)
      const padding = radiusMeters() * (attempt + 1)
      lastBounds = locations.length === 1
        ? boundsFromCenter(locations[0], padding)
        : padBounds(boundsFromPoints(locations), padding)

      const work = beginGraphLoad()
      const loaded = await loadGraph(lastBounds, [], work, { preserveSelectedPoints: true })
      if (!loaded) {
        return work.signal.aborted ? 'aborted' : false
      }
      if (!graph?.edges.length) {
        if (attempt < 4) return runExpansion(attempt + 1)
        return false
      }

      resnapPointsOntoGraph(selectedPoints.map((point) => ({ ...point })))
      tspStartPointId = selectedPoints.some((point) => point.id === tspStartId) ? tspStartId : selectedPoints[0]?.id
      renderPointList()
      updateUrl()

      if (!graphCoversPoints(selectedPoints.map((point) => point.location)) && attempt < 4) {
        return runExpansion(attempt + 1)
      }
      return graphCoversPoints(selectedPoints.map((point) => point.location))
    } catch {
      return false
    }
  }

  const expansion = graphExpansionChain.then(() => runExpansion())
  graphExpansionChain = expansion.then(() => true, () => true)
  return expansion
}

async function ensureGraphCoversPoints(): Promise<PointCoverageResult> {
  const locations = selectedPoints.map((point) => point.location)
  if (!locations.length) return { ok: graph !== undefined, reloaded: false }
  const needsReload = !graphCoversPoints(locations)
  if (!needsReload) return { ok: true, reloaded: false }
  const expanded = await expandGraphForPoints()
  if (expanded === 'aborted') return { ok: false, reloaded: false, aborted: true }
  if (!expanded) return { ok: false, reloaded: false }
  const covered = graphCoversPoints(selectedPoints.map((point) => point.location))
  return { ok: covered, reloaded: needsReload && covered }
}

function renderPolygon(): void {
  polygonLayer.clearLayers()
  if (!polygonPoints.length) return
  const latLngs = polygonPoints.map((point) => [point.lat, point.lon] as L.LatLngExpression)
  const valid = polygonPoints.length < 3 || isSimplePolygon(polygonPoints)
  const color = valid ? '#38bdf8' : '#ef4444'
  L.polyline(latLngs, {
    color,
    weight: 3,
    dashArray: '6 4',
    pane: 'polygonOverlay',
  }).addTo(polygonLayer)
  if (polygonPoints.length >= 3) {
    L.polygon(latLngs, {
      color,
      weight: 2,
      fillColor: color,
      fillOpacity: valid ? 0.08 : 0.16,
      pane: 'polygonOverlay',
    }).addTo(polygonLayer)
  }
  polygonPoints.forEach((point, index) => {
    const handle = L.marker([point.lat, point.lon], {
      draggable: true,
      pane: 'polygonOverlay',
      title: `Polygon vertex ${index + 1}`,
      icon: L.divIcon({
        className: 'polygon-handle',
        html: `<span>${index + 1}</span>`,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      }),
    }).addTo(polygonLayer)

    handle.on('dragstart', () => {
      clearCurrentAlgorithmResult()
      polygonDragging = true
      map.dragging.disable()
    })
    handle.on('drag', () => {
      const latlng = handle.getLatLng()
      polygonPoints[index] = { lat: latlng.lat, lon: latlng.lng }
      redrawPolygonShapeOnly()
    })
    handle.on('dragend', async () => {
      const latlng = handle.getLatLng()
      polygonPoints[index] = { lat: latlng.lat, lon: latlng.lng }
      polygonDragging = false
      suppressNextMapClick = true
      window.setTimeout(() => {
        suppressNextMapClick = false
      }, 0)
      map.dragging.enable()
      renderPolygon()
      updateUrl()
      if (polygonPoints.length >= 3) {
        if (validatePolygonForRun()) await reloadPolygonGraphAndRerun()
      }
    })
    handle.on('click', (event) => {
      L.DomEvent.stop(event)
    })
  })
  updateOperationEstimates()
}

async function reloadPolygonGraphAndRerun(): Promise<void> {
  if (polygonPoints.length < 3) return
  if (!validatePolygonForRun()) return
  const pointLocations = selectedPoints.map((point) => point.location)
  lastBounds = padBounds(boundsFromPoints(polygonPoints), 20)
  radiusBoundsSource = 'fixed'
  radiusBoundsCenter = undefined
  if (!await loadGraph(lastBounds, pointLocations)) return
  setStatus(`Polygon loaded. Running ${algorithmInfo[currentAlgorithm()].title}…`, 'loading')
  await runCurrentAlgorithm()
}

function validatePolygonForRun(): boolean {
  if (polygonPoints.length < 3 || isSimplePolygon(polygonPoints)) return true
  route = undefined
  renderer.setRoute(undefined)
  updateStats({})
  setStatus('Self-intersecting polygon.', 'error')
  return false
}

function clearRouteResult(): void {
  stopAutoPlayback()
  route = undefined
  renderer.setRoute(undefined)
  updateStats(graph ? { vertices: graph.nodes.length, edges: graph.edges.length } : {})
}

function clearCurrentAlgorithmResult(): void {
  cancelPendingWork()
  clearRouteResult()
}

function beginGraphLoad(): GraphLoadToken {
  activeGraphLoadController?.abort()
  activeGraphLoadController = new AbortController()
  return { id: ++graphLoadSerial, signal: activeGraphLoadController.signal }
}

function beginAlgorithmWork(): AlgorithmWorkToken {
  return { id: ++algorithmWorkSerial }
}

function cancelPendingWork(): void {
  if (pendingRerunTimer !== undefined) {
    window.clearTimeout(pendingRerunTimer)
    pendingRerunTimer = undefined
  }
  pendingPointFinalizations.length = 0
  activeGraphLoadController?.abort()
  graphLoadSerial++
  algorithmWorkSerial++
}

function isCurrentGraphLoad(work: GraphLoadToken): boolean {
  return work.id === graphLoadSerial && !work.signal.aborted
}

function isCurrentAlgorithmWork(work: AlgorithmWorkToken): boolean {
  return work.id === algorithmWorkSerial
}

function redrawPolygonShapeOnly(): void {
  const layers = polygonLayer.getLayers()
  const latLngs = polygonPoints.map((point) => [point.lat, point.lon] as L.LatLngExpression)
  for (const layer of layers) {
    if (layer instanceof L.Polygon || layer instanceof L.Polyline) layer.setLatLngs(latLngs)
  }
}

function togglePlay(): void {
  playing = !playing
  byId<HTMLButtonElement>('play').textContent = playing ? 'Auto playing' : 'Paused'
  if (playing) {
    animate()
  } else {
    cancelAnimationFrame(animationFrame)
  }
}

function startAutoPlayback(): void {
  cancelAnimationFrame(animationFrame)
  playing = true
  progress = 0
  progressInput.value = '0'
  renderer.setProgress(0)
  byId<HTMLButtonElement>('play').textContent = 'Auto playing'
  animate()
}

function stopAutoPlayback(): void {
  playing = false
  cancelAnimationFrame(animationFrame)
  animationFrame = 0
  byId<HTMLButtonElement>('play').textContent = 'Paused'
}

function animate(): void {
  if (!playing) return
  progress = Math.min(1, progress + 0.004)
  progressInput.value = String(progress)
  renderer.setProgress(progress)
  if (progress >= 1) {
    progress = 0
    progressInput.value = '0'
    renderer.setProgress(0)
  }
  animationFrame = requestAnimationFrame(animate)
}

function radiusMeters(): number {
  return Number(radiusInput.value)
}

function applyRadiusBoundsSource(locations: LatLng[]): void {
  if (locations.length === 1) {
    radiusBoundsSource = 'center'
    radiusBoundsCenter = locations[0]
    return
  }
  radiusBoundsSource = 'points'
  radiusBoundsCenter = undefined
}

function computeRadiusAwareBounds(): Bounds | undefined {
  if (radiusBoundsSource === 'fixed') return undefined
  if (radiusBoundsSource === 'center' && radiusBoundsCenter) {
    return boundsFromCenter(radiusBoundsCenter, radiusMeters())
  }
  if (radiusBoundsSource === 'points' && selectedPoints.length) {
    const locations = selectedPoints.map((point) => point.location)
    if (locations.length === 1) return boundsFromCenter(locations[0], radiusMeters())
    return padBounds(boundsFromPoints(locations), radiusMeters())
  }
  return undefined
}

function boundsRoughlyEqual(a: Bounds, b: Bounds): boolean {
  const epsilon = 1e-6
  return Math.abs(a.south - b.south) < epsilon
    && Math.abs(a.north - b.north) < epsilon
    && Math.abs(a.west - b.west) < epsilon
    && Math.abs(a.east - b.east) < epsilon
}

function scheduleRadiusReload(): void {
  if (radiusReloadTimer !== undefined) window.clearTimeout(radiusReloadTimer)
  radiusReloadTimer = window.setTimeout(() => {
    radiusReloadTimer = undefined
    void reloadGraphForRadiusChange()
  }, 350)
}

async function reloadGraphForRadiusChange(): Promise<void> {
  if (!graph) return
  const nextBounds = computeRadiusAwareBounds()
  if (!nextBounds) return
  if (lastBounds && boundsRoughlyEqual(nextBounds, lastBounds)) return

  const work = beginGraphLoad()
  const pointLocations = selectedPoints.map((point) => point.location)
  const tspStartIndex = selectedPoints.findIndex((point) => point.id === tspStartPointId)
  lastBounds = nextBounds
  updateUrl()
  setStatus(`Refetching graph (${radiusMeters()} m)…`, 'loading')
  if (!await loadGraph(nextBounds, pointLocations, work)) return
  if (!isCurrentGraphLoad(work)) return
  tspStartPointId = selectedPoints[tspStartIndex >= 0 ? tspStartIndex : 0]?.id
  renderPointList()
  if (selectedInputMode === 'polygon' && polygonPoints.length >= 3 && validatePolygonForRun()) {
    await runCurrentAlgorithm()
    return
  }
  await rerunAfterSelectionEdit()
}

function currentAlgorithm(): Algorithm {
  return selectedAlgorithm
}

function currentProfile(): TransportProfile {
  return selectedProfile
}

async function setAlgorithm(algorithm: Algorithm, rerun = true): Promise<void> {
  if (algorithm === 'matching' && matchingNeedsEvenPoints()) {
    setStatus(`Matching needs even count (${selectedPoints.length} points).`, 'warn')
    return
  }
  if (algorithm !== selectedAlgorithm && graph) {
    const operations = estimateAlgorithmOperations(
      algorithm,
      buildOperationCostContext(graph, selectedPoints.length),
    )
    if (algorithmExceedsBudget(operations)) {
      setStatus(`${algorithmInfo[algorithm].title} over budget (~${formatOperations(operations)}).`, 'error')
      return
    }
  }
  const previousInputMode = selectedInputMode
  const nextInputMode = algorithmNeedsPoints(algorithm) ? 'points' : 'polygon'
  if (rerun && previousInputMode !== nextInputMode) {
    const confirmed = window.confirm(nextInputMode === 'polygon'
      ? 'Chinese Postman uses polygon input and will clear the selected points. Continue?'
      : 'Point algorithms use selected points and will clear the selected polygon. Continue?')
    if (!confirmed) return
  }
  selectedAlgorithm = algorithm
  setInputMode(nextInputMode, false, false)
  if (previousInputMode !== nextInputMode) {
    if (nextInputMode === 'polygon') {
      selectedPoints = []
      tspStartPointId = undefined
      movingPointId = undefined
      renderer.setPoints(selectedPoints)
      renderPointList()
    } else {
      polygonPoints = []
      renderPolygon()
    }
  }
  for (const button of algorithmChoices.querySelectorAll<HTMLButtonElement>('[data-algorithm]')) {
    button.classList.toggle('active', button.dataset.algorithm === algorithm)
    button.setAttribute('aria-pressed', String(button.dataset.algorithm === algorithm))
  }
  clearCurrentAlgorithmResult()
  updateAlgorithmInfo()
  updateUrl()
  if (previousInputMode !== nextInputMode) {
    setStatus(nextInputMode === 'points'
      ? 'Points mode. Polygon cleared.'
      : 'Polygon mode. Points cleared.', 'success')
  } else {
    setStatus('Algorithm changed.', 'success')
  }
  if (rerun) await rerunAfterSelectionEdit()
}

async function setProfile(profile: TransportProfile, reload = true): Promise<void> {
  const pointLocations = selectedPoints.map((point) => point.location)
  const tspStartIndex = selectedPoints.findIndex((point) => point.id === tspStartPointId)
  selectedProfile = profile
  for (const button of profileChoices.querySelectorAll<HTMLButtonElement>('[data-profile]')) {
    button.classList.toggle('active', button.dataset.profile === profile)
    button.setAttribute('aria-pressed', String(button.dataset.profile === profile))
  }
  updateAlgorithmInfo()
  updateUrl()
  if (reload && lastBounds) {
    const bounds = computeRadiusAwareBounds() ?? lastBounds
    lastBounds = bounds
    if (!await loadGraph(bounds, pointLocations)) return
    tspStartPointId = selectedPoints[tspStartIndex >= 0 ? tspStartIndex : 0]?.id
    renderPointList()
    if (selectedInputMode === 'polygon' && polygonPoints.length >= 3 && validatePolygonForRun()) {
      await runCurrentAlgorithm()
    } else {
      await rerunAfterSelectionEdit()
    }
  }
}

function setInputMode(mode: InputMode, announce = true, clearOnChange = true): void {
  const changed = selectedInputMode !== mode
  selectedInputMode = mode
  if (mode === 'points' && !algorithmNeedsPoints(currentAlgorithm())) selectedAlgorithm = 'tspPath'
  if (mode === 'polygon' && algorithmNeedsPoints(currentAlgorithm())) selectedAlgorithm = 'postman'
  updateAlgorithmCards()
  for (const button of inputChoices.querySelectorAll<HTMLButtonElement>('[data-input-mode]')) {
    button.classList.toggle('active', button.dataset.inputMode === mode)
    button.setAttribute('aria-pressed', String(button.dataset.inputMode === mode))
  }
  if (changed && clearOnChange) clearSelection(false)
  updateAlgorithmInfo()
  updateUrl()
  if (!announce) return
  setStatus(mode === 'polygon' ? 'Polygon mode.' : 'Points mode.', 'success')
}

function updateAlgorithmCards(): void {
  for (const button of algorithmChoices.querySelectorAll<HTMLButtonElement>('[data-algorithm]')) {
    button.classList.toggle('active', button.dataset.algorithm === selectedAlgorithm)
    button.setAttribute('aria-pressed', String(button.dataset.algorithm === selectedAlgorithm))
  }
  updateOperationEstimates()
}

function updateOperationEstimates(): void {
  const context = buildOperationCostContext(graph, selectedPoints.length)
  const algorithms: OperationAlgorithm[] = ['tspPath', 'mst', 'tsp', 'matching', 'steiner', 'postman']
  const hasGraph = graph !== undefined
  const matchingOdd = matchingNeedsEvenPoints()

  for (const algorithm of algorithms) {
    const button = algorithmChoices.querySelector<HTMLButtonElement>(`[data-algorithm="${algorithm}"]`)
    if (!button) continue
    const operations = estimateAlgorithmOperations(algorithm, context)
    const fill = operationFillRatio(operations)
    const level = operationCostLevel(fill)
    const exactness = algorithmExactness(algorithm, context)
    const showApprox = shouldShowApproximation(algorithm, context, hasGraph)
    const tooExpensive = hasGraph && algorithmExceedsBudget(operations)
    const matchingBlocked = algorithm === 'matching' && matchingOdd
    const isActive = algorithm === selectedAlgorithm
    button.style.setProperty('--cost-fill', fill.toFixed(4))
    button.classList.remove('cost-idle', 'cost-low', 'cost-medium', 'cost-high')
    button.classList.add(`cost-${level}`)
    button.classList.toggle('approx-mode', showApprox && !tooExpensive && !matchingBlocked)
    button.classList.toggle('cost-prohibitive', tooExpensive)
    button.classList.toggle('cost-prohibitive-active', tooExpensive && isActive)
    button.classList.toggle('matching-odd', matchingBlocked && !tooExpensive)
    button.classList.toggle('matching-odd-active', matchingBlocked && isActive && !tooExpensive)
    button.disabled = (!isActive && tooExpensive) || (!isActive && matchingBlocked)
    button.dataset.exactness = exactness.label
    const complexityEl = button.querySelector<HTMLElement>('.choice-complexity')
    if (complexityEl) complexityEl.textContent = formatAlgorithmComplexity(algorithm, context)
    const badgeEl = button.querySelector<HTMLElement>('.choice-badge')
    if (badgeEl) {
      const badge = tooExpensive ? 'slow' : matchingBlocked ? 'odd' : showApprox ? 'approx' : ''
      badgeEl.textContent = badge
      badgeEl.classList.toggle('choice-badge-approx', showApprox && !tooExpensive && !matchingBlocked)
      badgeEl.classList.toggle('choice-badge-slow', tooExpensive)
      badgeEl.classList.toggle('choice-badge-odd', matchingBlocked && !tooExpensive)
    }
    const label = algorithmInfo[algorithm].title
    if (!hasGraph) {
      button.title = `${label}: load a graph to estimate runtime cost`
    } else if (tooExpensive) {
      button.title = isActive
        ? `${label}: currently selected but over the ~2s budget (~${formatOperations(operations)})`
        : `${label}: too expensive (~${formatOperations(operations)} ≥ ${formatOperations(MAX_ESTIMATED_OPERATIONS)} budget)`
    } else if (matchingBlocked) {
      button.title = `${label}: needs an even number of points (currently ${selectedPoints.length})`
    } else {
      const budget = `${Math.round(fill * 100)}% of ~${formatOperations(MAX_ESTIMATED_OPERATIONS)} budget`
      const mode = showApprox ? ` · ${exactness.label}` : ''
      button.title = `${label}: ~${formatOperations(operations)} (${budget})${mode}`
    }
  }

  const currentOps = estimateAlgorithmOperations(currentAlgorithm(), context)
  const currentFill = operationFillRatio(currentOps)
  const currentExactness = algorithmExactness(currentAlgorithm(), context)
  const showCurrentApprox = shouldShowApproximation(currentAlgorithm(), context, hasGraph)
  const currentTooExpensive = hasGraph && algorithmExceedsBudget(currentOps)
  const operationCostEl = byId('operationCost')
  operationCostEl.textContent = hasGraph
    ? `~${formatOperations(currentOps)} (${Math.round(currentFill * 100)}% of budget${showCurrentApprox ? ` · ${currentExactness.label}` : ''}${currentTooExpensive ? ' · over budget' : ''})`
    : '—'
  operationCostEl.classList.toggle('cost-prohibitive-label', currentTooExpensive)
}

function clearSelection(announce = true): void {
  selectedPoints = []
  polygonPoints = []
  movingPointId = undefined
  tspStartPointId = undefined
  optimisticPointLayer.clearLayers()
  renderer.setPoints(selectedPoints)
  renderPointList()
  renderPolygon()
  clearCurrentAlgorithmResult()
  updateUrl()
  if (announce) setStatus('Selection cleared.', 'idle')
}

function clearLoadedGraph(announce = true): void {
  clearSelection(false)
  cancelPendingWork()
  stopAutoPlayback()
  graph = undefined
  route = undefined
  renderer.setGraph(undefined)
  renderer.setRoute(undefined)
  updateStats({})
  updateOperationEstimates()
  updateUrl()
  if (announce) {
    setStatus('Graph and selection cleared.', 'idle')
  }
}

function matchingNeedsEvenPoints(): boolean {
  return selectedPoints.length > 0 && selectedPoints.length % 2 === 1
}

function setStatus(message: string, tone: StatusTone = inferStatusTone(message)): void {
  statusEl.textContent = message
  statusEl.dataset.tone = tone
  statusEl.closest('.panel-status')?.setAttribute('data-tone', tone)
}

type StatusTone = 'idle' | 'loading' | 'success' | 'error' | 'warn'

function inferStatusTone(message: string): StatusTone {
  const lower = message.toLowerCase()
  if (lower.includes('loading graph') || lower.includes('refetching') || lower.startsWith('running ')
    || lower.includes('. running ') || lower.endsWith('…')) {
    return 'loading'
  }
  if (lower.includes('failed') || lower.includes('could not') || lower.includes('self-intersecting')
    || lower.includes('over budget')) {
    return 'error'
  }
  if (lower.includes('need ') || lower.includes('click map to place') || lower.includes('load a graph')
    || lower.includes('no saved') || lower.includes('no valid') || lower.includes('before importing')
    || lower.includes('matching needs')) {
    return 'warn'
  }
  if (lower.includes('cleared') || lower.startsWith('click map to load')) {
    return 'idle'
  }
  return 'success'
}

function humanize(value: string): string {
  return value.replace(/[A-Z]/g, (match) => ` ${match.toLowerCase()}`)
}

function boundsContains(bounds: Bounds, point: LatLng): boolean {
  return point.lat >= bounds.south && point.lat <= bounds.north && point.lon >= bounds.west && point.lon <= bounds.east
}

function pointLabel(index: number): string {
  if (index < 26) return String.fromCharCode(65 + index)
  return String(index + 1)
}

function relabel(points: PointSelection[]): PointSelection[] {
  return points.map((point, index) => ({ ...point, label: pointLabel(index) }))
}

function updateUrl(): void {
  const params = new URLSearchParams()
  params.set('algorithm', currentAlgorithm())
  params.set('profile', currentProfile())
  params.set('input', selectedInputMode)
  params.set('radius', String(radiusMeters()))
  if (lastBounds) params.set('bounds', [lastBounds.south, lastBounds.west, lastBounds.north, lastBounds.east].join(','))
  if (selectedPoints.length) params.set('points', selectedPoints.map((point) => `${point.location.lat},${point.location.lon}`).join(';'))
  const tspStartIndex = selectedPoints.findIndex((point) => point.id === tspStartPointId)
  if (tspStartIndex > 0) params.set('tspStart', String(tspStartIndex))
  if (polygonPoints.length) params.set('polygon', polygonPoints.map((point) => `${point.lat},${point.lon}`).join(';'))
  history.replaceState(null, '', `${location.pathname}?${params.toString()}`)
}

async function restoreFromUrl(): Promise<void> {
  const params = new URLSearchParams(location.search)
  if (params.has('algorithm')) await setAlgorithm((params.get('algorithm') as Algorithm) ?? selectedAlgorithm, false)
  if (params.has('profile')) await setProfile((params.get('profile') as TransportProfile) ?? selectedProfile, false)
  if (params.has('input')) setInputMode((params.get('input') as InputMode) ?? selectedInputMode, false)
  if (params.has('radius')) radiusInput.value = params.get('radius') ?? radiusInput.value
  radiusLabel.textContent = `${radiusMeters()} m`
  polygonPoints = parsePointList(params.get('polygon'))
  renderPolygon()
  const bounds = parseBounds(params.get('bounds')) ?? (polygonPoints.length >= 3 ? padBounds(boundsFromPoints(polygonPoints), 20) : undefined)
  const restoredPoints = parsePointList(params.get('points'))
  if (polygonPoints.length >= 3) {
    radiusBoundsSource = 'fixed'
    radiusBoundsCenter = undefined
  } else if (restoredPoints.length) {
    applyRadiusBoundsSource(restoredPoints)
  } else if (bounds) {
    radiusBoundsSource = 'fixed'
    radiusBoundsCenter = undefined
  }
  if (bounds) {
    lastBounds = bounds
    await loadGraph(bounds)
    for (const point of restoredPoints) addPoint(point)
    const tspStartIndex = Number(params.get('tspStart') ?? 0)
    tspStartPointId = selectedPoints[tspStartIndex]?.id ?? selectedPoints[0]?.id
    renderPointList()
    await rerunAfterSelectionEdit()
  }
  updateAlgorithmInfo()
}

function saveExperiment(): void {
  const name = prompt('Experiment name?')
  if (!name) return
  const experiment: SavedExperiment = {
    id: crypto.randomUUID(),
    name,
    createdAt: Date.now(),
    algorithm: currentAlgorithm(),
    profile: currentProfile(),
    inputMode: selectedInputMode,
    radius: radiusMeters(),
    points: selectedPoints.map((point) => point.location),
    tspStartIndex: selectedPoints.findIndex((point) => point.id === tspStartPointId),
    bounds: lastBounds,
    polygon: polygonPoints,
  }
  const experiments = readExperiments()
  localStorage.setItem('experiments', JSON.stringify([experiment, ...experiments].slice(0, 30)))
  setStatus(`Saved experiment "${name}".`, 'success')
}

async function loadExperiment(): Promise<void> {
  const experiments = readExperiments()
  if (!experiments.length) {
    setStatus('No saved experiments yet.', 'warn')
    return
  }
  const list = experiments.map((experiment, index) => `${index + 1}. ${experiment.name}`).join('\n')
  const answer = prompt(`Load which experiment?\n${list}`)
  const index = Number(answer) - 1
  const experiment = experiments[index]
  if (!experiment) return
  await setAlgorithm(experiment.algorithm as Algorithm, false)
  await setProfile(experiment.profile, false)
  setInputMode((experiment as SavedExperiment & { inputMode?: InputMode }).inputMode ?? (algorithmNeedsPoints(experiment.algorithm) ? 'points' : 'polygon'), false)
  radiusInput.value = String(experiment.radius)
  polygonPoints = experiment.polygon ?? []
  renderPolygon()
  if (experiment.bounds) {
    if (polygonPoints.length >= 3) {
      radiusBoundsSource = 'fixed'
      radiusBoundsCenter = undefined
    } else if (experiment.points.length) {
      applyRadiusBoundsSource(experiment.points)
    } else {
      radiusBoundsSource = 'fixed'
      radiusBoundsCenter = undefined
    }
    lastBounds = experiment.bounds
    await loadGraph(experiment.bounds)
    for (const point of experiment.points) addPoint(point)
    tspStartPointId = selectedPoints[experiment.tspStartIndex ?? 0]?.id ?? selectedPoints[0]?.id
    renderPointList()
    await rerunAfterSelectionEdit()
  }
  updateAlgorithmInfo()
  setStatus(`Loaded experiment "${experiment.name}".`, 'success')
}

function shareCurrentUrl(): void {
  updateUrl()
  void navigator.clipboard?.writeText(location.href)
  setStatus('Share URL copied to clipboard.', 'success')
}

function exportPoints(): void {
  const data = {
    type: 'FeatureCollection',
    features: selectedPoints.map((point) => ({
      type: 'Feature',
      properties: { label: point.label, snapDistance: point.snapDistance },
      geometry: { type: 'Point', coordinates: [point.location.lon, point.location.lat] },
    })),
  }
  downloadText('osm-postman-points.geojson', JSON.stringify(data, null, 2), 'application/geo+json')
}

async function importPoints(): Promise<void> {
  if (!graph || !lastBounds) {
    setStatus('Load a graph before importing points.', 'warn')
    return
  }
  const raw = prompt('Paste GeoJSON FeatureCollection, or one "lat,lon" point per line.')
  if (!raw) return
  const points = parseImportedPoints(raw)
  if (!points.length) {
    setStatus('No valid points found.', 'warn')
    return
  }
  selectedPoints = []
  tspStartPointId = undefined
  renderer.setPoints(selectedPoints)
  for (const point of points) addPoint(point)
  await rerunAfterSelectionEdit()
  setStatus(`Imported ${points.length} points.`, 'success')
}

function readExperiments(): SavedExperiment[] {
  try {
    return JSON.parse(localStorage.getItem('experiments') ?? '[]') as SavedExperiment[]
  } catch {
    return []
  }
}

function parsePointList(raw: string | null): LatLng[] {
  if (!raw) return []
  return raw.split(';').map((pair) => {
    const [lat, lon] = pair.split(',').map(Number)
    return { lat, lon }
  }).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon))
}

function parseImportedPoints(raw: string): LatLng[] {
  try {
    const parsed = JSON.parse(raw) as {
      features?: Array<{ geometry?: { type?: string; coordinates?: number[] } }>
    }
    return parsed.features?.flatMap((feature) => {
      const coords = feature.geometry?.coordinates
      if (feature.geometry?.type !== 'Point' || !coords || coords.length < 2) return []
      return [{ lat: coords[1], lon: coords[0] }]
    }) ?? []
  } catch {
    return raw.split(/\n+/).map((line) => {
      const [lat, lon] = line.split(/[,\s]+/).map(Number)
      return { lat, lon }
    }).filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon))
  }
}

function parseBounds(raw: string | null): Bounds | undefined {
  if (!raw) return undefined
  const [south, west, north, east] = raw.split(',').map(Number)
  if ([south, west, north, east].every(Number.isFinite)) return { south, west, north, east }
  return undefined
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T
}
