import { describe, expect, test } from 'vitest'
import { addSnappedPoint, makeGraph } from './graph'
import { isSimplePolygon } from './geo'
import { solveChinesePostman } from './chinesePostman'
import { minPerfectMatching } from './algorithms/matching'
import { dijkstra, reconstructNodePath } from './algorithms/shortestPath'
import { kruskal } from './algorithms/mst'
import { heldKarp, nearestNeighbor, routeDistance } from './algorithms/tsp'
import { exactSteinerTree } from './algorithms/steinerTree'
import { runPointAlgorithm } from './pointAlgorithms'
import { elevationGameScore, elevationStatsForRoute, parseDemElevationResults, routePathForElevation } from './elevation'
import {
  algorithmExactness,
  algorithmExceedsBudget,
  buildOperationCostContext,
  estimateAlgorithmOperations,
  formatAlgorithmComplexity,
  formatOperations,
  MAX_ESTIMATED_OPERATIONS,
  operationFillRatio,
  shouldShowApproximation,
} from './operationCost'
import type { GraphEdge, GraphNode, StreetGraph } from './types'

describe('shortest paths', () => {
  test('reconstructs a shortest path', () => {
    const graph = fixtureGraph(4, [
      [0, 1, 1],
      [1, 2, 2],
      [0, 2, 10],
      [2, 3, 3],
    ])
    const result = dijkstra(graph, 0)

    expect(result.dist[3]).toBe(6)
    expect(reconstructNodePath(result, 0, 3)).toEqual([0, 1, 2, 3])
  })
})

describe('point snapping', () => {
  test('splits the selected edge instead of leaving a bypass edge', () => {
    const graph = fixtureGraph(2, [[0, 1, 100]])
    const result = addSnappedPoint(graph, { lat: 0.0002, lon: 0.0005 })

    expect(result.nodeId).toBe(2)
    expect(result.graph.edges).toHaveLength(2)
    expect(result.graph.edges.every((edge) => edge.u === 2 || edge.v === 2)).toBe(true)
  })
})

describe('polygon validation', () => {
  test('accepts simple polygons and rejects self-intersections', () => {
    expect(isSimplePolygon([
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
      { lat: 1, lon: 1 },
      { lat: 1, lon: 0 },
    ])).toBe(true)

    expect(isSimplePolygon([
      { lat: 0, lon: 0 },
      { lat: 1, lon: 1 },
      { lat: 0, lon: 1 },
      { lat: 1, lon: 0 },
    ])).toBe(false)
  })
})

describe('minimum matching', () => {
  test('finds exact small perfect matching', () => {
    const result = minPerfectMatching([
      [0, 1, 4, 4],
      [1, 0, 4, 4],
      [4, 4, 0, 2],
      [4, 4, 2, 0],
    ])

    expect(result.weight).toBe(3)
    expect(result.pairs).toEqual([[0, 1], [2, 3]])
  })

  test('uses Blossom fallback when DP limit is exceeded', () => {
    const result = minPerfectMatching([
      [0, 1, 4, 4],
      [1, 0, 4, 4],
      [4, 4, 0, 2],
      [4, 4, 2, 0],
    ], 2)

    expect(result.weight).toBe(3)
    expect(new Set(result.pairs.map((pair) => pair.toSorted().join('-')))).toEqual(new Set(['0-1', '2-3']))
  })

  test('point matching returns pairwise shortest paths as highlights only', () => {
    const graph = fixtureGraph(4, [
      [0, 1, 1],
      [1, 2, 10],
      [2, 3, 1],
      [0, 2, 4],
      [1, 3, 4],
    ])
    const result = runPointAlgorithm('matching', graph, [0, 1, 2, 3].map((node, index) => ({
      id: String(index),
      label: String(index),
      location: graph.nodes[node],
      snappedLocation: graph.nodes[node],
      snappedNode: node,
      snapDistance: 0,
    })))

    expect(result.distance).toBe(2)
    expect(result.path).toEqual([])
    expect(result.highlights?.map((edge) => edge.id).toSorted()).toEqual([0, 2])
  })
})

describe('mst', () => {
  test('uses Kruskal and detects connected result', () => {
    const result = kruskal(4, [
      { u: 0, v: 1, weight: 3 },
      { u: 0, v: 2, weight: 1 },
      { u: 2, v: 1, weight: 1 },
      { u: 1, v: 3, weight: 2 },
    ])

    expect(result.weight).toBe(4)
    expect(result.edges).toHaveLength(3)
  })
})

describe('tsp', () => {
  test('solves a square exactly with Held-Karp', () => {
    const distances = [
      [0, 1, 2, 1],
      [1, 0, 1, 2],
      [2, 1, 0, 1],
      [1, 2, 1, 0],
    ]
    const result = heldKarp(distances, true)

    expect(result.distance).toBe(4)
    expect(result.order[0]).toBe(0)
    expect(result.order.at(-1)).toBe(0)
  })

  test('heuristic returns a valid tour', () => {
    const distances = [
      [0, 2, 9, 10],
      [1, 0, 6, 4],
      [15, 7, 0, 8],
      [6, 3, 12, 0],
    ]
    const result = nearestNeighbor(distances, true)

    expect(new Set(result.order.slice(0, -1))).toEqual(new Set([0, 1, 2, 3]))
    expect(result.distance).toBe(routeDistance(distances, result.order))
  })

  test('solves an open path without returning to the start', () => {
    const distances = [
      [0, 1, 2],
      [1, 0, 1],
      [2, 1, 0],
    ]
    const result = heldKarp(distances, false)

    expect(result.distance).toBe(2)
    expect(result.order[0]).toBe(0)
    expect(result.order.at(-1)).not.toBe(0)
  })

  test('open TSP can start from a selected point', () => {
    const graph = fixtureGraph(3, [
      [0, 1, 1],
      [1, 2, 1],
      [0, 2, 5],
    ])
    const points = [0, 1, 2].map((node, index) => ({
      id: `p${index}`,
      label: String.fromCharCode(65 + index),
      location: graph.nodes[node],
      snappedLocation: graph.nodes[node],
      snappedNode: node,
      snapDistance: 0,
    }))

    const result = runPointAlgorithm('tspPath', graph, points, { tspStartPointId: 'p2' })

    expect(result.name).toBe('Open TSP Path')
    expect(result.distance).toBe(2)
    expect(result.path[0]).toEqual(graph.nodes[2])
    expect(result.path.at(-1)).not.toEqual(graph.nodes[2])
  })
})

describe('elevation', () => {
  test('scores steeper routes higher in the elevation game', () => {
    expect(elevationGameScore(50, 1000)).toBeGreaterThan(elevationGameScore(10, 1000))
  })

  test('adds elevation stats when graph nodes carry elevation tags', () => {
    const graph = fixtureGraphWithElevation([
      { id: 0, lat: 0, lon: 0, ele: 800 },
      { id: 1, lat: 0, lon: 0.001, ele: 860 },
    ], [[0, 1, 120]])
    const route = {
      name: 'Open TSP Path',
      distance: 120,
      path: [graph.nodes[0], graph.nodes[1]],
      edges: graph.edges,
      stats: {},
      complexity: '',
      approximation: '',
    }

    const stats = elevationStatsForRoute(graph, route)

    expect(stats.elevationGain).toBe('60 m')
    expect(stats.elevationGame).toBeTruthy()
  })

  test('derives elevation from highlighted edges when the route path is empty', () => {
    const graph = fixtureGraphWithElevation([
      { id: 0, lat: 0, lon: 0, ele: 100 },
      { id: 1, lat: 0, lon: 0.001, ele: 130 },
    ], [[0, 1, 120]])
    const route = {
      name: 'MST over selected points',
      distance: 120,
      path: [],
      edges: graph.edges,
      stats: {},
      complexity: '',
      approximation: '',
    }

    expect(routePathForElevation(route)).toHaveLength(2)
    expect(elevationStatsForRoute(graph, route).elevationGain).toBe('30 m')
  })

  test('shows zero gain on flat routes when elevation coverage is available', () => {
    const graph = fixtureGraphWithElevation([
      { id: 0, lat: 0, lon: 0, ele: 200 },
      { id: 1, lat: 0, lon: 0.001, ele: 200 },
    ], [[0, 1, 120]])
    const route = {
      name: 'TSP',
      distance: 120,
      path: [graph.nodes[0], graph.nodes[1]],
      edges: graph.edges,
      stats: {},
      complexity: '',
      approximation: '',
    }

    expect(elevationStatsForRoute(graph, route).elevationGain).toBe('0 m')
  })

  test('parses OpenTopoData elevation responses in order', () => {
    const elevations = parseDemElevationResults({
      results: [
        { elevation: 861, location: { lat: -19.9245, lng: -43.9352 } },
        { elevation: null, location: { lat: -19.93, lng: -43.94 } },
        { elevation: 870, location: { lat: -19.94, lng: -43.95 } },
      ],
    })
    expect(elevations).toEqual([861, NaN, 870])
  })
})

describe('steiner tree', () => {
  test('connects terminals through a cheaper Steiner vertex', () => {
    const graph = fixtureGraph(4, [
      [0, 1, 1],
      [1, 2, 1],
      [1, 3, 1],
      [0, 2, 5],
      [0, 3, 5],
      [2, 3, 5],
    ])
    const result = exactSteinerTree(graph, [0, 2, 3])

    expect(result.weight).toBe(3)
    expect(result.edgeIds).toHaveLength(3)
    expect(terminalsConnected(graph, result.edgeIds, [0, 2, 3])).toBe(true)
  })
})

describe('chinese postman', () => {
  test('keeps an Eulerian cycle exact', () => {
    const graph = fixtureGraph(3, [
      [0, 1, 1],
      [1, 2, 1],
      [2, 0, 1],
    ])
    const result = solveChinesePostman(graph)

    expect(result.distance).toBe(3)
    expect(result.stats.oddVertices).toBe(0)
    expect(result.path[0]).toEqual(result.path.at(-1))
  })

  test('duplicates the shortest connection for odd vertices', () => {
    const graph = fixtureGraph(3, [
      [0, 1, 2],
      [1, 2, 3],
    ])
    const result = solveChinesePostman(graph)

    expect(result.distance).toBe(10)
    expect(result.stats.oddVertices).toBe(2)
    expect(result.path[0]).toEqual(result.path.at(-1))
  })
})

describe('operation cost estimates', () => {
  test('returns zero without a loaded graph', () => {
    const context = buildOperationCostContext(undefined, 4)
    expect(estimateAlgorithmOperations('tsp', context)).toBe(0)
    expect(operationFillRatio(0)).toBe(0)
    expect(formatOperations(0)).toBe('—')
  })

  test('grows with graph size and point count', () => {
    const small = fixtureGraph(6, [[0, 1, 1], [1, 2, 1], [2, 3, 1], [3, 4, 1], [4, 5, 1]])
    const large = fixtureGraph(40, Array.from({ length: 39 }, (_, id) => [id, id + 1, 1] as [number, number, number]))
    const smallCtx = buildOperationCostContext(small, 4)
    const largeCtx = buildOperationCostContext(large, 4)
    const smallTsp = estimateAlgorithmOperations('tsp', smallCtx)
    const largeTsp = estimateAlgorithmOperations('tsp', largeCtx)
    expect(largeTsp).toBeGreaterThan(smallTsp)

    const fewPoints = estimateAlgorithmOperations('mst', buildOperationCostContext(small, 3))
    const manyPoints = estimateAlgorithmOperations('mst', buildOperationCostContext(small, 8))
    expect(manyPoints).toBeGreaterThan(fewPoints)
  })

  test('switches to cheaper Steiner fallback past the exact terminal limit', () => {
    const graph = fixtureGraph(20, Array.from({ length: 19 }, (_, id) => [id, id + 1, 1] as [number, number, number]))
    const exactSteiner = estimateAlgorithmOperations('steiner', buildOperationCostContext(graph, 6))
    const fallbackSteiner = estimateAlgorithmOperations('steiner', buildOperationCostContext(graph, 14))
    expect(fallbackSteiner).toBeLessThan(exactSteiner)
  })

  test('postman cost grows with odd-degree vertices', () => {
    const triangle = fixtureGraph(3, [[0, 1, 1], [1, 2, 1], [2, 0, 1]])
    const chain = fixtureGraph(6, [[0, 1, 1], [1, 2, 1], [2, 3, 1], [3, 4, 1], [4, 5, 1]])
    const triangleCost = estimateAlgorithmOperations('postman', buildOperationCostContext(triangle, 0))
    const chainCost = estimateAlgorithmOperations('postman', buildOperationCostContext(chain, 0))
    expect(chainCost).toBeGreaterThan(triangleCost)
  })

  test('caps fill ratio at the configured budget', () => {
    expect(operationFillRatio(MAX_ESTIMATED_OPERATIONS / 2)).toBeCloseTo(0.5)
    expect(operationFillRatio(MAX_ESTIMATED_OPERATIONS * 4)).toBe(1)
    expect(formatOperations(1_250_000)).toBe('1.3M ops')
  })

  test('flags heuristic TSP and approximate Steiner for large point sets', () => {
    const graph = fixtureGraph(20, Array.from({ length: 19 }, (_, id) => [id, id + 1, 1] as [number, number, number]))
    const fewPoints = buildOperationCostContext(graph, 6)
    const manyPoints = buildOperationCostContext(graph, 18)
    expect(algorithmExactness('tsp', fewPoints).exact).toBe(true)
    expect(algorithmExactness('tsp', manyPoints).exact).toBe(false)
    expect(shouldShowApproximation('tsp', manyPoints, true)).toBe(true)
    expect(algorithmExactness('steiner', fewPoints).exact).toBe(true)
    expect(algorithmExactness('steiner', manyPoints).exact).toBe(false)
    expect(shouldShowApproximation('mst', manyPoints, true)).toBe(false)
  })

  test('marks algorithms that exceed the operation budget', () => {
    expect(algorithmExceedsBudget(MAX_ESTIMATED_OPERATIONS - 1)).toBe(false)
    expect(algorithmExceedsBudget(MAX_ESTIMATED_OPERATIONS)).toBe(true)
    expect(algorithmExceedsBudget(MAX_ESTIMATED_OPERATIONS * 3)).toBe(true)
  })

  test('formats concise complexity labels for buttons', () => {
    const graph = fixtureGraph(20, Array.from({ length: 19 }, (_, id) => [id, id + 1, 1] as [number, number, number]))
    expect(formatAlgorithmComplexity('tsp', buildOperationCostContext(undefined, 0))).toBe('O(2^p)')
    expect(formatAlgorithmComplexity('tsp', buildOperationCostContext(graph, 6))).toBe('O(2^p)')
    expect(formatAlgorithmComplexity('tsp', buildOperationCostContext(graph, 20))).toBe('O(p⁴)')
    expect(formatAlgorithmComplexity('steiner', buildOperationCostContext(graph, 14))).toBe('O(p²)')
    expect(formatAlgorithmComplexity('postman', buildOperationCostContext(graph, 0))).toBe('O(2^k)')
  })
})

function fixtureGraphWithElevation(
  nodeSpecs: Array<{ id: number; lat: number; lon: number; ele: number }>,
  edgeSpecs: Array<[number, number, number]>,
): StreetGraph {
  const nodes: GraphNode[] = nodeSpecs.map((node) => ({
    id: node.id,
    lat: node.lat,
    lon: node.lon,
    ele: node.ele,
  }))
  const edges: GraphEdge[] = edgeSpecs.map(([u, v, length], id) => ({
    id,
    u,
    v,
    length,
    geometry: [nodes[u], nodes[v]],
  }))
  return makeGraph(nodes, edges)
}

function fixtureGraph(nodeCount: number, edgeSpecs: Array<[number, number, number]>): StreetGraph {
  const nodes: GraphNode[] = Array.from({ length: nodeCount }, (_, id) => ({
    id,
    lat: 0,
    lon: id * 0.001,
  }))
  const edges: GraphEdge[] = edgeSpecs.map(([u, v, length], id) => ({
    id,
    u,
    v,
    length,
    geometry: [nodes[u], nodes[v]],
  }))
  return makeGraph(nodes, edges)
}

function terminalsConnected(graph: StreetGraph, edgeIds: number[], terminals: number[]): boolean {
  const terminalSet = new Set(terminals)
  const adjacency = Array.from({ length: graph.nodes.length }, () => [] as number[])
  for (const id of edgeIds) {
    const edge = graph.edges[id]
    adjacency[edge.u].push(edge.v)
    adjacency[edge.v].push(edge.u)
  }
  const stack = [terminals[0]]
  const seen = new Set<number>(stack)
  while (stack.length) {
    const u = stack.pop()
    if (u === undefined) continue
    for (const v of adjacency[u]) {
      if (!seen.has(v)) {
        seen.add(v)
        stack.push(v)
      }
    }
  }
  return [...terminalSet].every((terminal) => seen.has(terminal))
}
