import { describe, expect, test, vi } from 'vitest'
import { abortAfter, combineAbortSignals } from './abortUtils'

describe('abort utils', () => {
  test('combineAbortSignals aborts when any parent aborts', () => {
    const parent = new AbortController()
    const combined = combineAbortSignals([parent.signal])
    parent.abort()
    expect(combined.aborted).toBe(true)
  })

  test('abortAfter aborts after the timeout', async () => {
    vi.useFakeTimers()
    const signal = abortAfter(1000)
    vi.advanceTimersByTime(1001)
    expect(signal.aborted).toBe(true)
    vi.useRealTimers()
  })
})
