import { MATCHING_DP_LIMIT } from './algorithms/matching'
import { STEINER_EXACT_TERMINAL_LIMIT } from './algorithms/steinerTree'
import { TSP_EXACT_LIMIT } from './algorithms/tsp'
import type { StreetGraph } from './types'

export type OperationAlgorithm =
  | 'postman'
  | 'mst'
  | 'tsp'
  | 'tspPath'
  | 'matching'
  | 'steiner'

export type OperationCostContext = {
  nodes: number
  edges: number
  oddVertices: number
  pointCount: number
}

/** Rough browser budget: ~5M primitive ops feels like ~2s on a typical laptop. */
export const MAX_ESTIMATED_OPERATIONS = 5_000_000

export function countOddVertices(graph: StreetGraph): number {
  return graph.nodes.filter((node) => graph.adjacency[node.id].length % 2 === 1).length
}

export function buildOperationCostContext(
  graph: StreetGraph | undefined,
  pointCount: number,
): OperationCostContext {
  if (!graph) {
    return { nodes: 0, edges: 0, oddVertices: 0, pointCount }
  }
  return {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    oddVertices: countOddVertices(graph),
    pointCount,
  }
}

function dijkstraOps(nodes: number, edges: number): number {
  const n = Math.max(nodes, 1)
  const m = Math.max(edges, 0)
  return m + n * Math.log2(n + 1)
}

function metricClosureOps(nodes: number, edges: number, points: number): number {
  const p = Math.max(points, 0)
  if (p === 0) return 0
  return p * dijkstraOps(nodes, edges) + p * p
}

function matchingCoreOps(size: number): number {
  const k = Math.max(size, 0)
  if (k <= 1) return 0
  if (k <= MATCHING_DP_LIMIT) return Math.pow(2, k) * k * k
  return Math.pow(k, 3) * 24
}

function tspCoreOps(points: number): number {
  const p = Math.max(points, 2)
  if (p <= TSP_EXACT_LIMIT) return p * p * Math.pow(2, p)
  return p * p * p * p
}

function steinerCoreOps(nodes: number, edges: number, points: number): number {
  const p = Math.max(points, 2)
  const n = Math.max(nodes, 1)
  if (p <= STEINER_EXACT_TERMINAL_LIMIT) {
    return Math.pow(3, p) * n + Math.pow(2, p) * dijkstraOps(nodes, edges)
  }
  return metricClosureOps(nodes, edges, p) + p * p * Math.log2(p + 1)
}

export function estimateAlgorithmOperations(
  algorithm: OperationAlgorithm,
  context: OperationCostContext,
): number {
  const { nodes, edges, oddVertices, pointCount } = context
  if (nodes === 0 || edges === 0) return 0

  if (algorithm === 'postman') {
    const k = Math.max(oddVertices, 0)
    const dijkstras = k * dijkstraOps(nodes, edges)
    const matching = matchingCoreOps(k)
    const euler = edges * 2
    return dijkstras + matching + euler
  }

  const points = Math.max(pointCount, 2)
  const evenPoints = points % 2 === 0 ? points : points + 1

  if (algorithm === 'mst') {
    return metricClosureOps(nodes, edges, points) + points * points * Math.log2(points + 1)
  }
  if (algorithm === 'tsp' || algorithm === 'tspPath') {
    return metricClosureOps(nodes, edges, points) + tspCoreOps(points)
  }
  if (algorithm === 'matching') {
    return metricClosureOps(nodes, edges, evenPoints) + matchingCoreOps(evenPoints)
  }
  return steinerCoreOps(nodes, edges, points)
}

export function operationFillRatio(operations: number, max = MAX_ESTIMATED_OPERATIONS): number {
  if (operations <= 0 || max <= 0) return 0
  return Math.min(1, operations / max)
}

export function algorithmExceedsBudget(
  operations: number,
  max = MAX_ESTIMATED_OPERATIONS,
): boolean {
  return operations >= max
}

export function formatOperations(operations: number): string {
  if (!Number.isFinite(operations) || operations <= 0) return '—'
  if (operations < 1_000) return `${Math.round(operations)} ops`
  if (operations < 1_000_000) return `${(operations / 1_000).toFixed(operations < 10_000 ? 1 : 0)}K ops`
  if (operations < 1_000_000_000) return `${(operations / 1_000_000).toFixed(operations < 10_000_000 ? 1 : 0)}M ops`
  return `${(operations / 1_000_000_000).toFixed(1)}B ops`
}

export function operationCostLevel(fill: number): 'idle' | 'low' | 'medium' | 'high' {
  if (fill <= 0) return 'idle'
  if (fill < 0.35) return 'low'
  if (fill < 0.75) return 'medium'
  return 'high'
}

export type AlgorithmExactness = {
  exact: boolean
  label: string
  detail: string
}

export function algorithmExactness(
  algorithm: OperationAlgorithm,
  context: OperationCostContext,
): AlgorithmExactness {
  const points = context.pointCount

  if (algorithm === 'postman' || algorithm === 'mst' || algorithm === 'matching') {
    return {
      exact: true,
      label: 'Exact',
      detail: algorithm === 'mst'
        ? 'Exact on the metric closure.'
        : 'Exact for this problem class.',
    }
  }

  if (algorithm === 'tsp' || algorithm === 'tspPath') {
    if (points < 2) {
      return { exact: true, label: 'Exact', detail: 'Exact Held-Karp for small point sets.' }
    }
    if (points > TSP_EXACT_LIMIT) {
      return {
        exact: false,
        label: 'Heuristic',
        detail: `Nearest-neighbor + 2-opt (${points} points > ${TSP_EXACT_LIMIT} exact limit).`,
      }
    }
    return { exact: true, label: 'Exact', detail: `Held-Karp exact DP for ${points} points.` }
  }

  if (points < 2) {
    return { exact: true, label: 'Exact', detail: 'Exact DP for small terminal sets.' }
  }
  if (points > STEINER_EXACT_TERMINAL_LIMIT) {
    return {
      exact: false,
      label: 'Approx',
      detail: `Metric-closure MST fallback (${points} terminals > ${STEINER_EXACT_TERMINAL_LIMIT} exact limit).`,
    }
  }
  return { exact: true, label: 'Exact', detail: `Exact Steiner DP for ${points} terminals.` }
}

export function shouldShowApproximation(
  algorithm: OperationAlgorithm,
  context: OperationCostContext,
  hasGraph: boolean,
): boolean {
  if (!hasGraph) return false
  const exactness = algorithmExactness(algorithm, context)
  if (exactness.exact) return false
  if (algorithm === 'tsp' || algorithm === 'tspPath' || algorithm === 'steiner') {
    return context.pointCount >= 2
  }
  return false
}

export function formatAlgorithmComplexity(
  algorithm: OperationAlgorithm,
  context: OperationCostContext,
): string {
  const { oddVertices, pointCount } = context

  if (algorithm === 'postman') {
    return oddVertices > MATCHING_DP_LIMIT ? 'O(k³)' : 'O(2^k)'
  }
  if (algorithm === 'mst') return 'O(p²)'
  if (algorithm === 'tsp' || algorithm === 'tspPath') {
    return pointCount > TSP_EXACT_LIMIT ? 'O(p⁴)' : 'O(2^p)'
  }
  if (algorithm === 'matching') return 'O(p³)'
  return pointCount > STEINER_EXACT_TERMINAL_LIMIT ? 'O(p²)' : 'O(3^p)'
}
