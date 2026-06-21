type Task = () => Promise<void>

const taskQueue: Task[] = []
let drainPromise: Promise<void> | null = null

/** Processes all tasks in the queue sequentially */
async function drain(): Promise<void> {
  while (taskQueue.length > 0) {
    const task = taskQueue.shift()!
    await task()
  }
}

/** Adds a task to the processing queue */
export function enqueue(task: Task): void {
  taskQueue.push(task)
  if (!drainPromise) {
    drainPromise = drain().then(() => {
      drainPromise = null
    })
  }
}

/** Returns a promise that resolves when the queue is empty */
export function waitForQueue(): Promise<void> {
  return drainPromise ?? Promise.resolve()
}
