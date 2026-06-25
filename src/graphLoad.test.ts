import { describe, expect, test } from 'vitest'
import { GraphLoadQueue } from './graphLoadQueue'

describe('graph load queue', () => {
  test('runs jobs sequentially and leaves a success status', async () => {
    const queue = new GraphLoadQueue()
    const statuses: string[] = []

    const first = queue.run(async (work, report) => {
      await delay(20)
      expect(queue.isCurrent(work)).toBe(true)
      report({ message: 'Graph: 3 nodes, 4 edges', tone: 'success' })
      return true
    }, (update) => statuses.push(update.message))

    const second = queue.run(async (_work, report) => {
      report({ message: 'Graph: 5 nodes, 6 edges', tone: 'success' })
      return true
    }, (update) => statuses.push(update.message))

    expect(await first).toEqual({ result: true, superseded: false })
    expect(await second).toEqual({ result: true, superseded: false })
    expect(statuses.at(-1)).toBe('Graph: 5 nodes, 6 edges')
    expect(queue.isInFlight()).toBe(false)
  })

  test('does not leave loading status when a job throws', async () => {
    const queue = new GraphLoadQueue()
    const statuses: string[] = []

    const outcome = await queue.run(async () => {
      throw new Error('Overpass returned 504')
    }, (update) => statuses.push(`${update.tone}:${update.message}`))

    expect(outcome.result).toBeUndefined()
    expect(outcome.superseded).toBe(false)
    expect(statuses).toContain('error:Graph load failed.')
    expect(statuses.at(-1)).not.toBe('loading:Loading graph…')
  })

  test('does not leave loading status when a job is cancelled mid-flight', async () => {
    const queue = new GraphLoadQueue()
    const statuses: string[] = []

    const pending = queue.run(async (work) => {
      await waitForAbort(work.signal)
      return false
    }, (update) => statuses.push(`${update.tone}:${update.message}`))

    await delay(5)
    queue.cancel()

    const outcome = await pending
    expect(outcome.result).toBe(false)
    expect(statuses).toContain('warn:Graph load cancelled.')
    expect(statuses.at(-1)).not.toBe('loading:Loading graph…')
  })

  test('serializes overlapping loads instead of aborting the queued successor', async () => {
    const queue = new GraphLoadQueue()
    const events: string[] = []

    const slow = queue.run(async () => {
      events.push('slow:start')
      await delay(40)
      events.push('slow:end')
      return 'slow'
    })

    const fast = queue.run(async () => {
      events.push('fast:start')
      return 'fast'
    })

    expect(await slow).toEqual({ result: 'slow', superseded: false })
    expect(await fast).toEqual({ result: 'fast', superseded: false })
    expect(events).toEqual(['slow:start', 'slow:end', 'fast:start'])
  })

  test('marks superseded when cancelled before the job finishes', async () => {
    const queue = new GraphLoadQueue()

    const outcome = await queue.run(async (work, report) => {
      queue.cancel()
      await delay(5)
      if (!queue.isCurrent(work)) return false
      report({ message: 'Graph: 1 nodes, 1 edges', tone: 'success' })
      return true
    })

    expect(outcome.result).toBe(false)
    expect(outcome.superseded).toBe(true)
  })

  test('expansion-style retries inside one queued job keep a terminal status', async () => {
    const queue = new GraphLoadQueue()
    const statuses: string[] = []

    const outcome = await queue.run(async (_work, report) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await delay(5)
        if (attempt < 2) continue
        report({ message: 'Graph: 5 nodes, 8 edges', tone: 'success' })
        return true
      }
      return false
    }, (update) => statuses.push(update.message))

    expect(outcome).toEqual({ result: true, superseded: false })
    expect(statuses[0]).toBe('Loading graph…')
    expect(statuses.at(-1)).toBe('Graph: 5 nodes, 8 edges')
  })

  test('queued failure followed by success does not stay on loading', async () => {
    const queue = new GraphLoadQueue()
    const statuses: string[] = []

    const failing = queue.run(async () => false, (update) => statuses.push(update.message))
    const succeeding = queue.run(async (_work, report) => {
      report({ message: 'Graph: 2 nodes, 2 edges', tone: 'success' })
      return true
    }, (update) => statuses.push(update.message))

    expect(await failing).toEqual({ result: false, superseded: false })
    expect(await succeeding).toEqual({ result: true, superseded: false })
    expect(statuses.at(-1)).toBe('Graph: 2 nodes, 2 edges')
  })

  test('clears loading tone when a job settles without reporting a terminal status', async () => {
    const queue = new GraphLoadQueue()
    const statuses: string[] = []

    const outcome = await queue.run(async () => {
      return 'aborted'
    }, (update) => statuses.push(`${update.tone}:${update.message}`))

    expect(outcome.result).toBe('aborted')
    expect(statuses).toContain('warn:Graph load interrupted.')
    expect(statuses.at(-1)).not.toBe('loading:Loading graph…')
  })
})

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  await new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}
