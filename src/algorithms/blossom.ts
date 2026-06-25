type BlossomEdge = {
  u: number
  v: number
  w: number
}

type QueueEdge = {
  u: number
  v: number
  w: number
}

const INF = 1 << 28

export function maxWeightMatching(nodeCount: number, edges: BlossomEdge[]): Array<[number, number]> {
  const solver = new BlossomSolver(nodeCount)
  return solver.run(edges)
}

class BlossomSolver {
  private readonly n: number
  private m: number
  private id = 0
  private h = 1
  private t = 0
  private e: QueueEdge[][]
  private p: number[][]
  private lk: number[]
  private sl: number[]
  private st: number[]
  private f: number[]
  private b: number[][]
  private s: number[]
  private ed: number[]
  private q: number[]
  private lab: number[]

  constructor(nodeCount: number) {
    this.n = nodeCount
    this.m = nodeCount
    const size = nodeCount * 2 + 5
    this.e = Array.from({ length: size }, (_, u) =>
      Array.from({ length: size }, (_, v) => ({ u, v, w: 0 })),
    )
    this.p = Array.from({ length: size }, () => [] as number[])
    this.lk = Array(size).fill(0)
    this.sl = Array(size).fill(0)
    this.st = Array(size).fill(0)
    this.f = Array(size).fill(0)
    this.b = Array.from({ length: size }, () => Array(size).fill(0))
    this.s = Array(size).fill(0)
    this.ed = Array(size).fill(0)
    this.q = Array(size).fill(0)
    this.lab = Array(size).fill(0)
  }

  run(edges: BlossomEdge[]): Array<[number, number]> {
    this.m = this.n
    this.id = 0
    this.ed.fill(0)
    this.lk.fill(0)
    for (let i = 1; i <= this.n; i++) {
      this.st[i] = i
      this.p[i] = []
      for (let j = 1; j <= this.n; j++) {
        this.e[i][j] = { u: i, v: j, w: 0 }
        this.b[i][j] = i === j ? i : 0
      }
    }

    let maxWeight = 0
    for (const edge of edges) {
      const u = edge.u + 1
      const v = edge.v + 1
      const w = edge.w
      if (w > this.e[u][v].w) {
        this.e[u][v] = { u, v, w }
        this.e[v][u] = { u: v, v: u, w }
        maxWeight = Math.max(maxWeight, w)
      }
    }
    for (let i = 1; i <= this.n; i++) this.lab[i] = maxWeight
    while (this.bfs()) {
      // Edmonds' primal-dual search augments one matching at a time.
    }

    const matching: Array<[number, number]> = []
    for (let i = 1; i <= this.n; i++) {
      if (i < this.lk[i]) matching.push([i - 1, this.lk[i] - 1])
    }
    return matching
  }

  private slack(edge: QueueEdge): number {
    return this.lab[edge.u] + this.lab[edge.v] - edge.w * 2
  }

  private upd(u: number, v: number): void {
    if (!this.sl[v] || this.slack(this.e[u][v]) < this.slack(this.e[this.sl[v]][v])) this.sl[v] = u
  }

  private ss(v: number): void {
    this.sl[v] = 0
    for (let u = 1; u <= this.n; u++) {
      if (this.e[u][v].w > 0 && this.st[u] !== v && !this.s[this.st[u]]) this.upd(u, v)
    }
  }

  private ins(u: number): void {
    if (u <= this.n) this.q[++this.t] = u
    else for (const v of this.p[u]) this.ins(v)
  }

  private mdf(u: number, w: number): void {
    this.st[u] = w
    if (u > this.n) for (const v of this.p[u]) this.mdf(v, w)
  }

  private gr(u: number, v: number): number {
    const idx = this.p[u].indexOf(v)
    if (idx & 1) {
      this.p[u] = [this.p[u][0], ...this.p[u].slice(1).reverse()]
      return this.p[u].length - idx
    }
    return idx
  }

  private stm(u: number, v: number): void {
    this.lk[u] = this.e[u][v].v
    if (u <= this.n) return
    const w = this.e[u][v]
    const x = this.b[u][w.u]
    const y = this.gr(u, x)
    for (let i = 0; i < y; i++) this.stm(this.p[u][i], this.p[u][i ^ 1])
    this.stm(x, v)
    this.p[u] = [...this.p[u].slice(y), ...this.p[u].slice(0, y)]
  }

  private aug(u: number, v: number): void {
    const w = this.st[this.lk[u]]
    this.stm(u, v)
    if (!w) return
    this.stm(w, this.st[this.f[w]])
    this.aug(this.st[this.f[w]], w)
  }

  private lca(uIn: number, vIn: number): number {
    let u = uIn
    let v = vIn
    this.id++
    while (u || v) {
      if (u) {
        if (this.ed[u] === this.id) return u
        this.ed[u] = this.id
        u = this.st[this.lk[u]]
        if (u) u = this.st[this.f[u]]
      }
      ;[u, v] = [v, u]
    }
    return 0
  }

  private add(u: number, a: number, vStart: number): void {
    let v = vStart
    let x = this.n + 1
    while (x <= this.m && this.st[x]) x++
    if (x > this.m) this.m++
    this.lab[x] = 0
    this.s[x] = 0
    this.st[x] = 0
    this.lk[x] = this.lk[a]
    this.p[x] = [a]
    for (let i = u, j = 0; i !== a; i = this.st[this.f[j]]) {
      this.p[x].push(i)
      j = this.st[this.lk[i]]
      this.p[x].push(j)
      this.ins(j)
    }
    this.p[x] = [this.p[x][0], ...this.p[x].slice(1).reverse()]
    for (let i = v, j = 0; i !== a; i = this.st[this.f[j]]) {
      this.p[x].push(i)
      j = this.st[this.lk[i]]
      this.p[x].push(j)
      this.ins(j)
    }
    this.mdf(x, x)
    for (let i = 1; i <= this.m; i++) {
      this.e[x][i] = { u: x, v: i, w: 0 }
      this.e[i][x] = { u: i, v: x, w: 0 }
    }
    for (let i = 1; i <= this.n; i++) this.b[x][i] = 0
    for (const child of this.p[x]) {
      for (v = 1; v <= this.m; v++) {
        if (!this.e[x][v].w || this.slack(this.e[child][v]) < this.slack(this.e[x][v])) {
          this.e[x][v] = { ...this.e[child][v] }
          this.e[v][x] = { ...this.e[v][child] }
        }
      }
      for (v = 1; v <= this.n; v++) if (this.b[child][v]) this.b[x][v] = child
    }
    this.ss(x)
  }

  private ex(u: number): void {
    for (const x of this.p[u]) this.mdf(x, x)
    const a = this.b[u][this.e[u][this.f[u]].u]
    const r = this.gr(u, a)
    for (let i = 0; i < r; i += 2) {
      const x = this.p[u][i]
      const y = this.p[u][i + 1]
      this.f[x] = this.e[y][x].u
      this.s[x] = 1
      this.s[y] = 0
      this.sl[x] = 0
      this.ss(y)
      this.ins(y)
    }
    this.s[a] = 1
    this.f[a] = this.f[u]
    for (let i = r + 1; i < this.p[u].length; i++) {
      this.s[this.p[u][i]] = -1
      this.ss(this.p[u][i])
    }
    this.st[u] = 0
  }

  private on(edge: QueueEdge): boolean {
    const u = this.st[edge.u]
    const v = this.st[edge.v]
    let a: number
    if (this.s[v] === -1) {
      this.f[v] = edge.u
      this.s[v] = 1
      a = this.st[this.lk[v]]
      this.sl[v] = 0
      this.sl[a] = 0
      this.s[a] = 0
      this.ins(a)
    } else if (!this.s[v]) {
      a = this.lca(u, v)
      if (!a) {
        this.aug(u, v)
        this.aug(v, u)
        return true
      }
      this.add(u, a, v)
    }
    return false
  }

  private bfs(): boolean {
    for (let i = 1; i <= this.m; i++) {
      this.s[i] = -1
      this.sl[i] = 0
    }
    this.h = 1
    this.t = 0
    for (let i = 1; i <= this.m; i++) {
      if (this.st[i] === i && !this.lk[i]) {
        this.f[i] = 0
        this.s[i] = 0
        this.ins(i)
      }
    }
    if (this.h > this.t) return false
    while (true) {
      while (this.h <= this.t) {
        const u = this.q[this.h++]
        if (this.s[this.st[u]] !== 1) {
          for (let v = 1; v <= this.n; v++) {
            if (this.e[u][v].w > 0 && this.st[u] !== this.st[v]) {
              if (this.slack(this.e[u][v])) this.upd(u, this.st[v])
              else if (this.on(this.e[u][v])) return true
            }
          }
        }
      }
      let x = INF
      for (let i = this.n + 1; i <= this.m; i++) {
        if (this.st[i] === i && this.s[i] === 1) x = Math.min(x, Math.floor(this.lab[i] / 2))
      }
      for (let i = 1; i <= this.m; i++) {
        if (this.st[i] === i && this.sl[i] && this.s[i] !== 1) {
          x = Math.min(x, Math.floor(this.slack(this.e[this.sl[i]][i]) / (2 ** (this.s[i] + 1))))
        }
      }
      for (let i = 1; i <= this.n; i++) {
        if (this.s[this.st[i]] !== -1) {
          this.lab[i] += (this.s[this.st[i]] * 2 - 1) * x
          if (this.lab[i] <= 0) return false
        }
      }
      for (let i = this.n + 1; i <= this.m; i++) {
        if (this.st[i] === i && this.s[this.st[i]] !== -1) this.lab[i] += (2 - this.s[this.st[i]] * 4) * x
      }
      this.h = 1
      this.t = 0
      for (let i = 1; i <= this.m; i++) {
        if (this.st[i] === i && this.sl[i] && this.st[this.sl[i]] !== i && !this.slack(this.e[this.sl[i]][i])) {
          if (this.on(this.e[this.sl[i]][i])) return true
        }
      }
      for (let i = this.n + 1; i <= this.m; i++) if (this.st[i] === i && this.s[i] === 1 && !this.lab[i]) this.ex(i)
    }
  }
}
