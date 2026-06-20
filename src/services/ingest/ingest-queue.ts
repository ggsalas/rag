type Task = () => Promise<void>

const taskQueue: Task[] = []
let drainPromise: Promise<void> | null = null

async function drain(): Promise<void> {
  while (taskQueue.length > 0) {
    await taskQueue.shift()!()
  }
}

export function enqueue(task: Task): void {
  taskQueue.push(task)
  if (!drainPromise) {
    drainPromise = drain().then(() => {
      drainPromise = null
    })
  }
}

export function waitForQueue(): Promise<void> {
  return drainPromise ?? Promise.resolve()
}
