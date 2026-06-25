export function combineAbortSignals(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()
  const abort = () => controller.abort()
  for (const signal of signals) {
    if (signal.aborted) {
      abort()
      return controller.signal
    }
    signal.addEventListener('abort', abort, { once: true })
  }
  return controller.signal
}

export function abortAfter(ms: number, parent?: AbortSignal): AbortSignal {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  const clear = () => clearTimeout(timer)
  controller.signal.addEventListener('abort', clear, { once: true })
  if (parent) {
    if (parent.aborted) {
      clear()
      controller.abort()
      return controller.signal
    }
    parent.addEventListener('abort', () => {
      clear()
      controller.abort()
    }, { once: true })
  }
  return controller.signal
}
