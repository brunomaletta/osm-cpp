import type { StreetGraph } from '../types'
import { PriorityQueue } from './priorityQueue'
import { buildMetricClosure } from './shortestPath'
import { completeGraphMst } from './mst'

type Parent =
  | { type: 'merge'; a: number; b: number }
  | { type: 'move'; prev: number; edgeId: number }
  | undefined

export type SteinerResult = {
  weight: number
  edgeIds: number[]
  exact: boolean
}

export const STEINER_EXACT_TERMINAL_LIMIT = 10

export function solveSteinerTree(
  graph: StreetGraph,
  terminals: number[],
  limit = STEINER_EXACT_TERMINAL_LIMIT,
): SteinerResult {
  if (terminals.length === 0) return { weight: 0, edgeIds: [], exact: true }
  if (terminals.length === 1) return { weight: 0, edgeIds: [], exact: true }
  if (terminals.length <= limit) return exactSteinerTree(graph, terminals)
  return approximateSteinerTree(graph, terminals)
}

export function exactSteinerTree(graph: StreetGraph, terminals: number[]): SteinerResult {
  const k = terminals.length
  const masks = 1 << k
  const n = graph.nodes.length
  const dp = Array.from({ length: masks }, () => Array(n).fill(Infinity))
  const parent: Parent[][] = Array.from({ length: masks }, () => Array<Parent>(n).fill(undefined))

  for (let i = 0; i < k; i++) dp[1 << i][terminals[i]] = 0

  for (let mask = 1; mask < masks; mask++) {
    for (let a = (mask - 1) & mask; a > 0; a = (a - 1) & mask) {
      const b = mask ^ a
      if (b > a) continue
      for (let v = 0; v < n; v++) {
        const value = dp[a][v] + dp[b][v]
        if (value < dp[mask][v]) {
          dp[mask][v] = value
          parent[mask][v] = { type: 'merge', a, b }
        }
      }
    }

    const pq = new PriorityQueue<number>()
    for (let v = 0; v < n; v++) {
      if (Number.isFinite(dp[mask][v])) pq.push(dp[mask][v], v)
    }
    while (pq.size) {
      const item = pq.pop()
      if (!item) break
      const { priority, value: u } = item
      if (priority !== dp[mask][u]) continue
      for (const edge of graph.adjacency[u]) {
        const next = priority + edge.weight
        if (next < dp[mask][edge.to]) {
          dp[mask][edge.to] = next
          parent[mask][edge.to] = { type: 'move', prev: u, edgeId: edge.edgeId }
          pq.push(next, edge.to)
        }
      }
    }
  }

  const full = masks - 1
  let root = 0
  for (let v = 1; v < n; v++) if (dp[full][v] < dp[full][root]) root = v
  return { weight: dp[full][root], edgeIds: uniqueEdges(reconstruct(full, root, parent, terminals)), exact: true }
}

export function approximateSteinerTree(graph: StreetGraph, terminals: number[]): SteinerResult {
  const closure = buildMetricClosure(graph, terminals)
  const mst = completeGraphMst(closure.distances)
  const edgeIds: number[] = []
  for (const edge of mst.edges) edgeIds.push(...closure.paths[edge.u][edge.v])
  const unique = uniqueEdges(edgeIds)
  return {
    weight: unique.reduce((sum, id) => sum + graph.edges[id].length, 0),
    edgeIds: unique,
    exact: false,
  }
}

function reconstruct(mask: number, v: number, parent: Parent[][], terminals: number[]): number[] {
  const p = parent[mask][v]
  if (!p) {
    const terminalIndex = terminals.indexOf(v)
    if (terminalIndex >= 0 && mask === (1 << terminalIndex)) return []
    return []
  }
  if (p.type === 'merge') return [...reconstruct(p.a, v, parent, terminals), ...reconstruct(p.b, v, parent, terminals)]
  return [...reconstruct(mask, p.prev, parent, terminals), p.edgeId]
}

function uniqueEdges(edgeIds: number[]): number[] {
  return [...new Set(edgeIds)]
}
