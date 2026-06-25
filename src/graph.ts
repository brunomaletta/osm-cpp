import { haversineMeters, midpoint, pointInPolygon, polylineLength } from './geo'
import type { GraphEdge, GraphNode, LatLng, StreetGraph, TransportProfile } from './types'

export type OsmNode = {
  type: 'node'
  id: number
  lat: number
  lon: number
  tags?: Record<string, string>
}

export type OsmWay = {
  type: 'way'
  id: number
  nodes: number[]
  tags?: Record<string, string>
}

export type OsmElement = OsmNode | OsmWay

export function buildStreetGraph(
  elements: OsmElement[],
  profile: TransportProfile,
): StreetGraph {
  const osmNodes = new Map<number, OsmNode>()
  const ways: OsmWay[] = []
  for (const element of elements) {
    if (element.type === 'node') osmNodes.set(element.id, element)
    else if (element.type === 'way') ways.push(element)
  }

  const nodes: GraphNode[] = []
  const nodeByOsm = new Map<number, number>()
  const edges: GraphEdge[] = []

  function getNode(osmId: number): number | undefined {
    const existing = nodeByOsm.get(osmId)
    if (existing !== undefined) return existing
    const node = osmNodes.get(osmId)
    if (!node) return undefined
    const id = nodes.length
    const ele = parseElevation(node.tags?.ele)
    nodes.push({ id, osmId, lat: node.lat, lon: node.lon, ele })
    nodeByOsm.set(osmId, id)
    return id
  }

  for (const way of ways) {
    for (let i = 1; i < way.nodes.length; i++) {
      const u = getNode(way.nodes[i - 1])
      const v = getNode(way.nodes[i])
      if (u === undefined || v === undefined || u === v) continue
      const geometry = [nodes[u], nodes[v]].map(({ lat, lon }) => ({ lat, lon }))
      const length = polylineLength(geometry)
      if (length <= 0) continue
      edges.push({ id: edges.length, u, v, length, geometry, osmWayId: way.id, tags: way.tags, oneWay: isOneWay(way) })
    }
  }

  return largestConnectedComponent(makeGraph(nodes, edges, profile))
}

export function makeGraph(nodes: GraphNode[], edges: GraphEdge[], profile: TransportProfile = 'pedestrian'): StreetGraph {
  const adjacency = Array.from({ length: nodes.length }, () => [] as StreetGraph['adjacency'][number])
  edges.forEach((edge, id) => {
    edge.id = id
    adjacency[edge.u].push({ to: edge.v, edgeId: id, weight: edge.length })
    adjacency[edge.v].push({ to: edge.u, edgeId: id, weight: edge.length })
  })
  return { nodes, edges, adjacency, profile }
}

export function largestConnectedComponent(graph: StreetGraph): StreetGraph {
  const seen = Array(graph.nodes.length).fill(false)
  let best: number[] = []

  for (let start = 0; start < graph.nodes.length; start++) {
    if (seen[start]) continue
    const stack = [start]
    const component: number[] = []
    seen[start] = true
    while (stack.length) {
      const u = stack.pop()
      if (u === undefined) continue
      component.push(u)
      for (const edge of graph.adjacency[u]) {
        if (!seen[edge.to]) {
          seen[edge.to] = true
          stack.push(edge.to)
        }
      }
    }
    if (component.length > best.length) best = component
  }

  if (best.length === graph.nodes.length) return graph
  const keep = new Set(best)
  const remap = new Map<number, number>()
  const nodes = best.map((oldId, id) => {
    remap.set(oldId, id)
    const old = graph.nodes[oldId]
    return { ...old, id }
  })
  const edges: GraphEdge[] = []
  for (const edge of graph.edges) {
    if (!keep.has(edge.u) || !keep.has(edge.v)) continue
    const u = remap.get(edge.u)
    const v = remap.get(edge.v)
    if (u === undefined || v === undefined) continue
    edges.push({ ...edge, id: edges.length, u, v })
  }
  return makeGraph(nodes, edges, graph.profile)
}

export function clipGraphToPolygon(graph: StreetGraph, polygon: LatLng[]): StreetGraph {
  if (polygon.length < 3) return graph
  const edges = graph.edges.filter((edge) => {
    const mid = edge.geometry.length >= 2
      ? midpoint(edge.geometry[0], edge.geometry[edge.geometry.length - 1])
      : edge.geometry[0]
    return pointInPolygon(mid, polygon) || edge.geometry.some((point) => pointInPolygon(point, polygon))
  })
  const used = new Set<number>()
  for (const edge of edges) {
    used.add(edge.u)
    used.add(edge.v)
  }
  const remap = new Map<number, number>()
  const nodes = [...used].sort((a, b) => a - b).map((oldId, id) => {
    remap.set(oldId, id)
    return { ...graph.nodes[oldId], id }
  })
  const remappedEdges = edges.flatMap((edge, id) => {
    const u = remap.get(edge.u)
    const v = remap.get(edge.v)
    if (u === undefined || v === undefined) return []
    return [{ ...edge, id, u, v }]
  })
  return largestConnectedComponent(makeGraph(nodes, remappedEdges, graph.profile))
}

export function nearestNode(graph: StreetGraph, point: LatLng): number {
  if (!graph.nodes.length) throw new Error('Graph has no nodes.')
  let best = 0
  let bestDist = Infinity
  for (const node of graph.nodes) {
    const dist = haversineMeters(point, node)
    if (dist < bestDist) {
      bestDist = dist
      best = node.id
    }
  }
  return best
}

export function addSnappedPoint(graph: StreetGraph, point: LatLng): {
  graph: StreetGraph
  nodeId: number
  location: LatLng
  distance: number
} {
  if (!graph.edges.length) {
    if (!graph.nodes.length) {
      return { graph, nodeId: -1, location: point, distance: Infinity }
    }
    const nodeId = nearestNode(graph, point)
    const node = graph.nodes[nodeId]
    return {
      graph,
      nodeId,
      location: { lat: node.lat, lon: node.lon },
      distance: haversineMeters(point, node),
    }
  }
  const snap = nearestPointOnGraph(graph, point)
  const original = graph.edges[snap.edgeId]
  if (!original) {
    return { graph, nodeId: -1, location: point, distance: Infinity }
  }
  const nearU = haversineMeters(graph.nodes[original.u], snap.location)
  const nearV = haversineMeters(graph.nodes[original.v], snap.location)
  if (nearU < 0.5) return { graph, nodeId: original.u, location: graph.nodes[original.u], distance: snap.distance }
  if (nearV < 0.5) return { graph, nodeId: original.v, location: graph.nodes[original.v], distance: snap.distance }

  const nodeId = graph.nodes.length
  const node: GraphNode = { id: nodeId, lat: snap.location.lat, lon: snap.location.lon }
  const geometryA = [...original.geometry.slice(0, snap.segmentIndex), snap.location]
  const geometryB = [snap.location, ...original.geometry.slice(snap.segmentIndex)]
  const edgeA: GraphEdge = {
    id: 0,
    u: original.u,
    v: nodeId,
    length: polylineLength(geometryA),
    geometry: geometryA,
    osmWayId: original.osmWayId,
    tags: original.tags,
    oneWay: original.oneWay,
  }
  const edgeB: GraphEdge = {
    id: 0,
    u: nodeId,
    v: original.v,
    length: polylineLength(geometryB),
    geometry: geometryB,
    osmWayId: original.osmWayId,
    tags: original.tags,
    oneWay: original.oneWay,
  }
  const edges = graph.edges.filter((edge) => edge.id !== original.id)

  return {
    graph: makeGraph([...graph.nodes, node], [...edges, edgeA, edgeB], graph.profile),
    nodeId,
    location: snap.location,
    distance: snap.distance,
  }
}

export function edgeGeometryInDirection(edge: GraphEdge, from: number): LatLng[] {
  return from === edge.u ? edge.geometry : [...edge.geometry].reverse()
}

export function nearestPointOnGraph(graph: StreetGraph, point: LatLng): {
  edgeId: number
  segmentIndex: number
  location: LatLng
  distance: number
} {
  let best: { edgeId: number; segmentIndex: number; location: LatLng; distance: number } = {
    edgeId: 0,
    segmentIndex: 1,
    location: graph.nodes[0] ? { lat: graph.nodes[0].lat, lon: graph.nodes[0].lon } : point,
    distance: Infinity,
  }
  for (const edge of graph.edges) {
    for (let i = 1; i < edge.geometry.length; i++) {
      const candidate = projectToSegment(point, edge.geometry[i - 1], edge.geometry[i])
      const distance = haversineMeters(point, candidate)
      if (distance < best.distance) best = { edgeId: edge.id, segmentIndex: i, location: candidate, distance }
    }
  }
  return best
}

function projectToSegment(point: LatLng, a: LatLng, b: LatLng): LatLng {
  const latScale = 111320
  const lonScale = 111320 * Math.max(0.15, Math.cos(point.lat * Math.PI / 180))
  const ax = a.lon * lonScale
  const ay = a.lat * latScale
  const bx = b.lon * lonScale
  const by = b.lat * latScale
  const px = point.lon * lonScale
  const py = point.lat * latScale
  const dx = bx - ax
  const dy = by - ay
  const denom = dx * dx + dy * dy
  const t = denom === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denom))
  return {
    lon: (ax + dx * t) / lonScale,
    lat: (ay + dy * t) / latScale,
  }
}

function parseElevation(value: string | undefined): number | undefined {
  if (!value) return undefined
  const ele = Number(value)
  return Number.isFinite(ele) ? ele : undefined
}

function isOneWay(way: OsmWay): boolean {
  const tags = way.tags ?? {}
  return tags.oneway === 'yes' || tags.oneway === '1' || tags.oneway === 'true' || tags.junction === 'roundabout'
}
