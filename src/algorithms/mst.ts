export type WeightedEdge = {
  u: number
  v: number
  weight: number
}

export class DisjointSet {
  private parent: number[]
  private rank: number[]

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i)
    this.rank = Array(size).fill(0)
  }

  find(x: number): number {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x])
    return this.parent[x]
  }

  union(a: number, b: number): boolean {
    let x = this.find(a)
    let y = this.find(b)
    if (x === y) return false
    if (this.rank[x] < this.rank[y]) [x, y] = [y, x]
    this.parent[y] = x
    if (this.rank[x] === this.rank[y]) this.rank[x]++
    return true
  }
}

export function kruskal(nodeCount: number, edges: WeightedEdge[]) {
  const dsu = new DisjointSet(nodeCount)
  const chosen: WeightedEdge[] = []
  let weight = 0

  for (const edge of [...edges].sort((a, b) => a.weight - b.weight)) {
    if (dsu.union(edge.u, edge.v)) {
      chosen.push(edge)
      weight += edge.weight
    }
  }

  return {
    weight: chosen.length === Math.max(0, nodeCount - 1) ? weight : Infinity,
    edges: chosen,
  }
}

export function completeGraphMst(distances: number[][]) {
  const edges: WeightedEdge[] = []
  for (let i = 0; i < distances.length; i++) {
    for (let j = i + 1; j < distances.length; j++) {
      if (Number.isFinite(distances[i][j])) edges.push({ u: i, v: j, weight: distances[i][j] })
    }
  }
  return kruskal(distances.length, edges)
}
