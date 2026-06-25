import { edgeGeometryInDirection, makeGraph } from './graph'
import type { GraphEdge, LatLng, RouteResult, StreetGraph } from './types'
import { minPerfectMatching, MATCHING_DP_LIMIT } from './algorithms/matching'
import { dijkstra, reconstructEdgePath } from './algorithms/shortestPath'
import { formatDistance } from './geo'

export function solveChinesePostman(graph: StreetGraph): RouteResult {
  if (graph.nodes.length === 0 || graph.edges.length === 0) throw new Error('The selected region has no connected graph.')

  const oddVertices = graph.nodes.filter((node) => graph.adjacency[node.id].length % 2 === 1).map((node) => node.id)
  const augmentedEdges = graph.edges.map((edge) => ({ ...edge }))
  const duplicatedOriginalEdges: GraphEdge[] = []
  const shortestRuns = new Map<number, ReturnType<typeof dijkstra>>()
  const distances = oddVertices.map(() => Array(oddVertices.length).fill(0))

  for (let i = 0; i < oddVertices.length; i++) {
    const run = dijkstra(graph, oddVertices[i])
    shortestRuns.set(oddVertices[i], run)
    for (let j = 0; j < oddVertices.length; j++) distances[i][j] = run.dist[oddVertices[j]]
  }

  const matching = minPerfectMatching(distances)
  for (const [aIndex, bIndex] of matching.pairs) {
    const source = oddVertices[aIndex]
    const target = oddVertices[bIndex]
    const run = shortestRuns.get(source)
    if (!run) continue
    for (const edgeId of reconstructEdgePath(run, source, target)) {
      const original = graph.edges[edgeId]
      const duplicate = { ...original, id: augmentedEdges.length, duplicated: true }
      augmentedEdges.push(duplicate)
      duplicatedOriginalEdges.push(original)
    }
  }

  const augmented = makeGraph(graph.nodes.map((node) => ({ ...node })), augmentedEdges, graph.profile)
  const tourEdgeIds = eulerCircuit(augmented, 0)
  const path = edgeTourToCoordinates(augmented, tourEdgeIds, 0)
  const distance = augmented.edges.reduce((sum, edge) => sum + edge.length, 0)

  return {
    name: 'Chinese Postman',
    distance,
    path,
    edges: augmented.edges,
    highlights: duplicatedOriginalEdges,
    terminals: oddVertices,
    terminalLocations: oddVertices.map((id) => graph.nodes[id]),
    complexity: 'Dijkstra from each odd vertex plus exact matching DP O(2^k k^2), then Hierholzer O(E).',
    approximation: `Exact for undirected graphs. Uses bitmask DP up to ${MATCHING_DP_LIMIT} odd vertices and the contorno Blossom-style fallback above that.`,
    stats: {
      vertices: graph.nodes.length,
      edges: graph.edges.length,
      oddVertices: oddVertices.length,
      repeatedDistance: formatDistance(matching.weight),
      totalDistance: formatDistance(distance),
    },
  }
}

export function eulerCircuit(graph: StreetGraph, start: number): number[] {
  const used = Array(graph.edges.length).fill(false)
  const cursor = Array(graph.nodes.length).fill(0)
  const vertexStack = [start]
  const edgeStack: number[] = []
  const result: number[] = []

  while (vertexStack.length) {
    const v = vertexStack[vertexStack.length - 1]
    while (cursor[v] < graph.adjacency[v].length && used[graph.adjacency[v][cursor[v]].edgeId]) cursor[v]++
    if (cursor[v] === graph.adjacency[v].length) {
      vertexStack.pop()
      const edgeId = edgeStack.pop()
      if (edgeId !== undefined) result.push(edgeId)
      continue
    }
    const edge = graph.adjacency[v][cursor[v]++]
    used[edge.edgeId] = true
    vertexStack.push(edge.to)
    edgeStack.push(edge.edgeId)
  }

  if (result.length !== graph.edges.length) throw new Error('Could not build an Euler circuit for the selected graph.')
  return result.reverse()
}

function edgeTourToCoordinates(graph: StreetGraph, edgeIds: number[], start: number): LatLng[] {
  const path: LatLng[] = [graph.nodes[start]]
  let at = start
  for (const edgeId of edgeIds) {
    const edge = graph.edges[edgeId]
    const geometry = edgeGeometryInDirection(edge, at)
    const next = edge.u === at ? edge.v : edge.v === at ? edge.u : -1
    if (next === -1) throw new Error('Euler edge order is inconsistent.')
    path.push(...geometry.slice(1))
    at = next
  }
  return path
}
