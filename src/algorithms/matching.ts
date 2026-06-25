import { maxWeightMatching } from './blossom'

export type MatchingResult = {
  weight: number
  pairs: Array<[number, number]>
}

export const MATCHING_DP_LIMIT = 22

export function minPerfectMatching(distances: number[][], limit = MATCHING_DP_LIMIT): MatchingResult {
  const n = distances.length
  if (n % 2 !== 0) throw new Error('Minimum perfect matching needs an even number of vertices.')
  if (n === 0) return { weight: 0, pairs: [] }
  if (n > limit) return blossomMinPerfectMatching(distances)

  const full = (1 << n) - 1
  const memo = new Map<number, MatchingResult>()

  function solve(mask: number): MatchingResult {
    if (mask === 0) return { weight: 0, pairs: [] }
    const cached = memo.get(mask)
    if (cached) return cached

    let first = 0
    while ((mask & (1 << first)) === 0) first++

    let best: MatchingResult = { weight: Infinity, pairs: [] }
    const withoutFirst = mask ^ (1 << first)
    for (let j = first + 1; j < n; j++) {
      if ((withoutFirst & (1 << j)) === 0) continue
      const rest = solve(withoutFirst ^ (1 << j))
      const weight = distances[first][j] + rest.weight
      if (weight < best.weight) best = { weight, pairs: [[first, j], ...rest.pairs] }
    }

    memo.set(mask, best)
    return best
  }

  return solve(full)
}

export function minPerfectMatchingBlossom(distances: number[][]): MatchingResult {
  return blossomMinPerfectMatching(distances)
}

function blossomMinPerfectMatching(distances: number[][]): MatchingResult {
  let maxDistance = 0
  const scaled = distances.map((row) => row.map((value) => {
    const scaledValue = Math.round(value * 1000)
    maxDistance = Math.max(maxDistance, scaledValue)
    return scaledValue
  }))
  const offset = maxDistance + 1
  const edges: Array<{ u: number; v: number; w: number }> = []
  for (let i = 0; i < scaled.length; i++) {
    for (let j = i + 1; j < scaled.length; j++) {
      if (Number.isFinite(scaled[i][j])) edges.push({ u: i, v: j, w: offset - scaled[i][j] })
    }
  }
  const pairs = maxWeightMatching(scaled.length, edges)
  if (pairs.length * 2 !== scaled.length) throw new Error('No perfect matching exists for this graph.')
  return {
    pairs,
    weight: pairs.reduce((sum, [a, b]) => sum + distances[a][b], 0),
  }
}
