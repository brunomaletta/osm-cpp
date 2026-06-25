export type QueueItem<T> = {
  priority: number
  value: T
}

export class PriorityQueue<T> {
  private heap: Array<QueueItem<T>> = []

  get size(): number {
    return this.heap.length
  }

  push(priority: number, value: T): void {
    this.heap.push({ priority, value })
    this.bubbleUp(this.heap.length - 1)
  }

  pop(): QueueItem<T> | undefined {
    if (this.heap.length === 0) return undefined
    const top = this.heap[0]
    const last = this.heap.pop()
    if (last && this.heap.length > 0) {
      this.heap[0] = last
      this.bubbleDown(0)
    }
    return top
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = (index - 1) >> 1
      if (this.heap[parent].priority <= this.heap[index].priority) break
      ;[this.heap[parent], this.heap[index]] = [this.heap[index], this.heap[parent]]
      index = parent
    }
  }

  private bubbleDown(index: number): void {
    while (true) {
      const left = index * 2 + 1
      const right = left + 1
      let best = index
      if (left < this.heap.length && this.heap[left].priority < this.heap[best].priority) best = left
      if (right < this.heap.length && this.heap[right].priority < this.heap[best].priority) best = right
      if (best === index) break
      ;[this.heap[best], this.heap[index]] = [this.heap[index], this.heap[best]]
      index = best
    }
  }
}
