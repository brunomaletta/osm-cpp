export type TspResult = {
  distance: number
  order: number[]
  exact: boolean
}

export const TSP_EXACT_LIMIT = 16

export function solveTsp(distances: number[][], closed = true, limit = TSP_EXACT_LIMIT): TspResult {
  if (distances.length <= limit) return heldKarp(distances, closed)
  return twoOpt(distances, nearestNeighbor(distances, closed), closed)
}

export function heldKarp(distances: number[][], closed = true): TspResult {
  const n = distances.length
  if (n === 0) return { distance: 0, order: [], exact: true }
  if (n === 1) return { distance: 0, order: [0], exact: true }

  const states = 1 << n
  const dp = Array.from({ length: states }, () => Array(n).fill(Infinity))
  const parent = Array.from({ length: states }, () => Array(n).fill(-1))
  dp[1][0] = 0

  for (let mask = 1; mask < states; mask++) {
    if ((mask & 1) === 0) continue
    for (let last = 0; last < n; last++) {
      if (!Number.isFinite(dp[mask][last])) continue
      for (let next = 1; next < n; next++) {
        if (mask & (1 << next)) continue
        const nextMask = mask | (1 << next)
        const value = dp[mask][last] + distances[last][next]
        if (value < dp[nextMask][next]) {
          dp[nextMask][next] = value
          parent[nextMask][next] = last
        }
      }
    }
  }

  const full = states - 1
  let best = Infinity
  let last = 0
  for (let i = 0; i < n; i++) {
    const value = dp[full][i] + (closed ? distances[i][0] : 0)
    if (value < best) {
      best = value
      last = i
    }
  }

  const order: number[] = []
  let mask = full
  while (last !== -1) {
    order.push(last)
    const p = parent[mask][last]
    mask ^= 1 << last
    last = p
  }
  order.reverse()
  if (closed && order.length) order.push(order[0])

  return { distance: best, order, exact: true }
}

export function nearestNeighbor(distances: number[][], closed = true): TspResult {
  const n = distances.length
  if (n === 0) return { distance: 0, order: [], exact: false }
  const used = Array(n).fill(false)
  const order = [0]
  used[0] = true

  while (order.length < n) {
    const last = order[order.length - 1]
    let best = -1
    for (let i = 0; i < n; i++) {
      if (!used[i] && (best === -1 || distances[last][i] < distances[last][best])) best = i
    }
    if (best === -1) break
    used[best] = true
    order.push(best)
  }
  if (closed) order.push(0)
  return { distance: routeDistance(distances, order), order, exact: false }
}

export function twoOpt(distances: number[][], initial: TspResult, closed = true): TspResult {
  const order = [...initial.order]
  const end = closed ? order.length - 1 : order.length
  let improved = true
  while (improved) {
    improved = false
    for (let i = 1; i < end - 1; i++) {
      for (let j = i + 1; j < end; j++) {
        const candidate = [...order]
        candidate.splice(i, j - i + 1, ...order.slice(i, j + 1).reverse())
        const current = routeDistance(distances, order)
        const next = routeDistance(distances, candidate)
        if (next + 1e-9 < current) {
          order.splice(0, order.length, ...candidate)
          improved = true
        }
      }
    }
  }
  return { distance: routeDistance(distances, order), order, exact: false }
}

export function routeDistance(distances: number[][], order: number[]): number {
  let total = 0
  for (let i = 1; i < order.length; i++) total += distances[order[i - 1]][order[i]]
  return total
}
