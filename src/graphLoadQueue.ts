export type GraphLoadToken = {
  id: number
  signal: AbortSignal
}

export type StatusTone = 'idle' | 'loading' | 'success' | 'error' | 'warn'

export type StatusUpdate = {
  message: string
  tone: StatusTone
}

export type GraphLoadJobResult<T> = {
  result: T
  superseded: boolean
}

export type GraphLoadLog = (event: string, data?: Record<string, unknown>) => void

export class GraphLoadQueue {
  private serial = 0
  private controller?: AbortController
  private chain: Promise<void> = Promise.resolve()
  private lastStatus: StatusUpdate | undefined
  private inFlight = false
  private log: GraphLoadLog

  constructor(log: GraphLoadLog = () => undefined) {
    this.log = log
  }

  getLastStatus(): StatusUpdate | undefined {
    return this.lastStatus
  }

  isInFlight(): boolean {
    return this.inFlight
  }

  cancel(): void {
    this.log('cancel', { serial: this.serial, inFlight: this.inFlight })
    this.controller?.abort()
    this.serial++
  }

  begin(): GraphLoadToken {
    this.controller?.abort()
    this.controller = new AbortController()
    const work = { id: ++this.serial, signal: this.controller.signal }
    this.log('begin', { workId: work.id })
    return work
  }

  isCurrent(work: GraphLoadToken): boolean {
    return work.id === this.serial && !work.signal.aborted
  }

  async run<T>(
    job: (work: GraphLoadToken, reportStatus: (update: StatusUpdate) => void) => Promise<T>,
    onStatus?: (update: StatusUpdate) => void,
  ): Promise<GraphLoadJobResult<T>> {
    const queued = this.chain.then(async (): Promise<GraphLoadJobResult<T>> => {
      const work = this.begin()
      this.inFlight = true
      let settled = false
      this.log('run:start', { workId: work.id })
      const reportStatus = (update: StatusUpdate) => {
        this.lastStatus = update
        this.log('status', { workId: work.id, ...update })
        onStatus?.(update)
      }

      try {
        reportStatus({ message: 'Loading graph…', tone: 'loading' })
        const result = await job(work, reportStatus)
        settled = true
        const outcome = { result, superseded: !this.isCurrent(work) }
        this.log('run:done', {
          workId: work.id,
          settled,
          superseded: outcome.superseded,
          aborted: work.signal.aborted,
          result,
          lastStatus: this.lastStatus?.message,
        })
        return outcome
      } catch (error) {
        this.log('run:error', {
          workId: work.id,
          error: error instanceof Error ? error.message : String(error),
        })
        return { result: undefined as T, superseded: !this.isCurrent(work) }
      } finally {
        this.inFlight = false
        const stuckLoading = this.lastStatus?.tone === 'loading'
        if (stuckLoading) {
          if (work.signal.aborted || !this.isCurrent(work)) {
            reportStatus({ message: 'Graph load cancelled.', tone: 'warn' })
          } else if (!settled) {
            reportStatus({ message: 'Graph load failed.', tone: 'error' })
          } else {
            this.log('run:stuck-loading', {
              workId: work.id,
              resultSettled: settled,
              lastStatus: this.lastStatus?.message,
            })
            reportStatus({ message: 'Graph load interrupted.', tone: 'warn' })
          }
        }
        this.log('run:finally', {
          workId: work.id,
          serial: this.serial,
          inFlight: this.inFlight,
          lastStatus: this.lastStatus?.message,
          lastTone: this.lastStatus?.tone,
        })
      }
    })

    this.chain = queued.then(() => undefined, () => undefined)
    return queued
  }
}
