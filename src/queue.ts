export interface Job {
  id: string
  run: (signal: AbortSignal) => Promise<void>
}

export interface JobQueue {
  enqueue(job: Job): void
  cancel(id: string): boolean
  active(): number
  pending(): number
}

export function createQueue(): JobQueue {
  let running = 0
  const pending: Job[] = []
  const inflight = new Set<string>()
  const controllers = new Map<string, AbortController>()

  function drain(): void {
    if (running >= 1 || pending.length === 0) return
    const job = pending.shift()
    if (!job) return
    running++
    console.log(`[queue] Starting job ${job.id} (${pending.length} pending)`)

    const controller = new AbortController()
    controllers.set(job.id, controller)

    job
      .run(controller.signal)
      .catch((err) => console.error(`[queue] Job ${job.id} failed:`, err))
      .finally(() => {
        running--
        inflight.delete(job.id)
        controllers.delete(job.id)
        console.log(`[queue] Finished job ${job.id} (${pending.length} pending)`)
        drain()
      })
  }

  return {
    enqueue(job: Job): void {
      if (inflight.has(job.id)) {
        console.log(`[queue] Skipping duplicate job ${job.id}`)
        return
      }
      inflight.add(job.id)
      pending.push(job)
      console.log(`[queue] Enqueued job ${job.id} (${pending.length} pending)`)
      drain()
    },
    cancel(id: string): boolean {
      // Cancel running job
      const controller = controllers.get(id)
      if (controller) {
        console.log(`[queue] Cancelling running job ${id}`)
        controller.abort()
        return true
      }
      // Remove from pending queue
      const idx = pending.findIndex((j) => j.id === id)
      if (idx !== -1) {
        pending.splice(idx, 1)
        inflight.delete(id)
        console.log(`[queue] Removed pending job ${id}`)
        return true
      }
      return false
    },
    active: () => running,
    pending: () => pending.length,
  }
}
