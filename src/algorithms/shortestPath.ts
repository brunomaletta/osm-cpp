import type { StreetGraph } from '../types'
import { PriorityQueue } from './priorityQueue'

export type DijkstraResult = {
  dist: number[]
  prevNode: number[]
  prevEdge: number[]
}

export function dijkstra(graph: StreetGraph, source: number): DijkstraResult {
  const dist = Array(graph.nodes.length).fill(Infinity)
  const prevNode = Array(graph.nodes.length).fill(-1)
  const prevEdge = Array(graph.nodes.length).fill(-1)
  const pq = new PriorityQueue<number>()
  dist[source] = 0
  pq.push(0, source)

  while (pq.size) {
    const item = pq.pop()
    if (!item) break
    const { priority, value: u } = item
    if (priority !== dist[u]) continue
    for (const edge of graph.adjacency[u]) {
      const next = priority + edge.weight
      if (next < dist[edge.to]) {
        dist[edge.to] = next
        prevNode[edge.to] = u
        prevEdge[edge.to] = edge.edgeId
        pq.push(next, edge.to)
      }
    }
  }

  return { dist, prevNode, prevEdge }
}

export function reconstructNodePath(result: DijkstraResult, source: number, target: number): number[] {
  if (source === target) return [source]
  if (result.prevNode[target] === -1) return []
  const path: number[] = []
  for (let at = target; at !== -1; at = result.prevNode[at]) {
    path.push(at)
    if (at === source) break
  }
  path.reverse()
  return path[0] === source ? path : []
}

export function reconstructEdgePath(result: DijkstraResult, source: number, target: number): number[] {
  const nodes = reconstructNodePath(result, source, target)
  if (nodes.length <= 1) return []
  const edges: number[] = []
  for (let i = 1; i < nodes.length; i++) edges.push(result.prevEdge[nodes[i]])
  return edges
}

export function buildMetricClosure(graph: StreetGraph, terminals: number[]) {
  const runs = new Map<number, DijkstraResult>()
  const distances = terminals.map(() => Array(terminals.length).fill(Infinity))
  const paths = terminals.map(() => Array.from({ length: terminals.length }, () => [] as number[]))

  for (let i = 0; i < terminals.length; i++) {
    const run = dijkstra(graph, terminals[i])
    runs.set(terminals[i], run)
    for (let j = 0; j < terminals.length; j++) {
      distances[i][j] = run.dist[terminals[j]]
      paths[i][j] = reconstructEdgePath(run, terminals[i], terminals[j])
    }
  }

  return { distances, paths, runs }
}
