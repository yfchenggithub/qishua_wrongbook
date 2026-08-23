export interface SerialTaskQueue {
  enqueue<T>(task: () => Promise<T>): Promise<T>;
}

export function createSerialTaskQueue(): SerialTaskQueue {
  let tail: Promise<void> = Promise.resolve();

  return {
    enqueue<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}

const databaseWriteQueue = createSerialTaskQueue();

export function enqueueDatabaseWrite<T>(task: () => Promise<T>): Promise<T> {
  return databaseWriteQueue.enqueue(task);
}
