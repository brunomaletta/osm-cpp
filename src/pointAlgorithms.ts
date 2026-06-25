import type { GraphEdge, LatLng, PointSelection, RouteResult, StreetGraph } from './types'
import { buildMetricClosure } from './algorithms/shortestPath'
import { completeGraphMst } from './algorithms/mst'
import { minPerfectMatchingBlossom } from './algorithms/matching'
import { solveTsp } from './algorithms/tsp'
import { solveSteinerTree } from './algorithms/steinerTree'
import { formatDistance, edgeCollectionToPath } from './geo'
import { edgeGeometryInDirection } from './graph'

export type PointAlgorithm = 'mst' | 'tsp' | 'tspPath' | 'matching' | 'steiner'

export function runPointAlgorithm(
  algorithm: PointAlgorithm,
  graph: StreetGraph,
  points: PointSelection[],
  options: { tspStartPointId?: string } = {},
): RouteResult {
  if (points.length < 2) throw new Error('Add at least two points first.')
  const terminals = points.map((point) => point.snappedNode)
  if (terminals.some((nodeId) => nodeId < 0 || nodeId >= graph.nodes.length)) {
    throw new Error('Points are still being placed on the graph.')
  }
  const clickedLocations = points.map((point) => point.location)
  const maxSnapDistance = Math.max(...points.map((point) => point.snapDistance))
  const closure = buildMetricClosure(graph, terminals)
  if (!metricClosureConnected(closure.distances)) {
    throw new Error('Some points are not connected by walkable roads. Try moving points closer or increasing radius.')
  }

  if (algorithm === 'mst') {
    const result = completeGraphMst(closure.distances)
    const edgeIds = result.edges.flatMap((edge) => closure.paths[edge.u][edge.v])
    return edgeIdsResult('MST over selected points', graph, edgeIds, terminals, clickedLocations, result.weight, maxSnapDistance, false, {
      complexity: 'Kruskal on the selected-point metric closure: O(p^2 log p), plus Dijkstra preprocessing.',
      approximation: 'Exact MST on the metric closure; not a route by itself.',
    })
  }

  if (algorithm === 'tsp' || algorithm === 'tspPath') {
    const startIndex = Math.max(0, points.findIndex((point) => point.id === options.tspStartPointId))
    const permutation = [startIndex, ...points.map((_, index) => index).filter((index) => index !== startIndex)]
    const distances = permutation.map((i) => permutation.map((j) => closure.distances[i][j]))
    const result = solveTsp(distances, algorithm === 'tsp')
    const order = result.order.map((index) => permutation[index])
    const route = metricRouteToPath(graph, closure.paths, terminals, order)
    const uniqueEdges = [...new Set(route.edgeIds)].map((id) => graph.edges[id]).filter(Boolean)
    const exactText = result.exact
      ? 'Exact for this point count.'
      : 'Heuristic; no formal approximation guarantee.'
    return {
      name: algorithm === 'tsp' ? 'Traveling Salesperson Tour' : 'Open TSP Path',
      distance: result.distance,
      path: route.path,
      edges: route.edgeIds.map((id) => graph.edges[id]).filter(Boolean),
      terminals,
      terminalLocations: clickedLocations,
      complexity: result.exact
        ? 'Held-Karp exact DP: O(p^2 2^p).'
        : 'Nearest-neighbor plus 2-opt heuristic after Dijkstra preprocessing.',
      approximation: `${exactText} Starts at ${points[startIndex]?.label ?? 'the first point'}${algorithm === 'tsp' ? ' and returns to it.' : ' and ends wherever the shortest Hamiltonian path ends.'}`,
      stats: {
        selectedPoints: terminals.length,
        traversedEdges: route.edgeIds.length,
        displayedEdges: uniqueEdges.length,
        distance: formatDistance(result.distance),
        maxSnap: formatDistance(maxSnapDistance),
      },
    }
  }

  if (algorithm === 'matching') {
    if (points.length % 2 !== 0) throw new Error('Minimum weighted matching needs an even number of selected points.')
    const result = minPerfectMatchingBlossom(closure.distances)
    const edgeIds = result.pairs.flatMap(([a, b]) => closure.paths[a][b])
    return matchingResult(graph, edgeIds, terminals, clickedLocations, result.weight, maxSnapDistance, result.pairs.length)
  }

  const result = solveSteinerTree(graph, terminals)
  return edgeIdsResult('Steiner Tree', graph, result.edgeIds, terminals, clickedLocations, result.weight, maxSnapDistance, false, {
    complexity: result.exact
      ? 'Exact DP plus Dijkstra: O(3^p n + 2^p m log m).'
      : 'Metric-closure MST approximation after Dijkstra preprocessing.',
    approximation: result.exact ? 'Exact for this terminal count.' : '2-approximation for metric Steiner tree style closure.',
  })
}

function metricClosureConnected(distances: number[][]): boolean {
  for (let i = 0; i < distances.length; i++) {
    for (let j = i + 1; j < distances.length; j++) {
      if (!Number.isFinite(distances[i][j])) return false
    }
  }
  return true
}

function matchingResult(
  graph: StreetGraph,
  edgeIds: number[],
  terminals: number[],
  clickedLocations: LatLng[],
  distance: number,
  maxSnapDistance: number,
  pairCount: number,
): RouteResult {
  const uniqueEdges = [...new Set(edgeIds)].map((id) => graph.edges[id]).filter(Boolean)
  return {
    name: 'Minimum Weighted Matching',
    distance,
    path: [],
    edges: uniqueEdges,
    highlights: uniqueEdges,
    terminals,
    terminalLocations: clickedLocations,
    complexity: 'Weighted Blossom on the complete graph of selected points, after Dijkstra metric-closure preprocessing.',
    approximation: 'Exact minimum weighted matching on pairwise OSM shortest-path distances.',
    stats: {
      selectedPoints: terminals.length,
      matchedPairs: pairCount,
      displayedEdges: uniqueEdges.length,
      distance: formatDistance(distance),
      maxSnap: formatDistance(maxSnapDistance),
    },
  }
}

function edgeIdsResult(
  name: string,
  graph: StreetGraph,
  edgeIds: number[],
  terminals: number[],
  clickedLocations: LatLng[],
  distance: number,
  maxSnapDistance: number,
  drawAsRoute: boolean,
  info: { complexity: string; approximation: string },
): RouteResult {
  const uniqueEdges = [...new Set(edgeIds)].map((id) => graph.edges[id]).filter(Boolean)
  return {
    name,
    distance,
    path: drawAsRoute ? edgeCollectionToPath(uniqueEdges) : [],
    edges: uniqueEdges,
    highlights: drawAsRoute ? undefined : uniqueEdges,
    terminals,
    terminalLocations: clickedLocations,
    complexity: info.complexity,
    approximation: info.approximation,
    stats: {
      selectedPoints: terminals.length,
      displayedEdges: uniqueEdges.length,
      distance: formatDistance(distance),
      maxSnap: formatDistance(maxSnapDistance),
    },
  }
}

export function algorithmNeedsPoints(algorithm: string): boolean {
  return ['mst', 'tsp', 'tspPath', 'matching', 'steiner'].includes(algorithm)
}

export function routeEdgesFromIds(graph: StreetGraph, edgeIds: number[]): GraphEdge[] {
  return edgeIds.map((id) => graph.edges[id]).filter(Boolean)
}

function metricRouteToPath(
  graph: StreetGraph,
  paths: number[][][],
  terminals: number[],
  order: number[],
): { edgeIds: number[]; path: LatLng[] } {
  const edgeIds: number[] = []
  const path: LatLng[] = []
  let currentNode = terminals[order[0]]
  if (currentNode !== undefined) path.push(graph.nodes[currentNode])

  for (let i = 1; i < order.length; i++) {
    for (const edgeId of paths[order[i - 1]][order[i]]) {
      const edge = graph.edges[edgeId]
      const geometry = edgeGeometryInDirection(edge, currentNode)
      if (path.length === 0) path.push(...geometry)
      else path.push(...geometry.slice(1))
      edgeIds.push(edgeId)
      currentNode = edge.u === currentNode ? edge.v : edge.u
    }
  }

  return { edgeIds, path }
}
