export interface Job {
  id: string
  run: () => Promise<void>
}

export interface JobQueue {
  enqueue(job: Job): void
  active(): number
  pending(): number
}

export function createQueue(): JobQueue {
  let running = 0
  const pending: Job[] = []
  const inflight = new Set<string>()

  function drain(): void {
    if (running >= 1 || pending.length === 0) return
    const job = pending.shift()
    if (!job) return
    running++
    console.log(`[queue] Starting job ${job.id} (${pending.length} pending)`)

    job
      .run()
      .catch((err) => console.error(`[queue] Job ${job.id} failed:`, err))
      .finally(() => {
        running--
        inflight.delete(job.id)
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
    active: () => running,
    pending: () => pending.length,
  }
}
