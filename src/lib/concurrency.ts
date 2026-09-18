/**
 * Splits an array into chunks of maximum `size`.
 */
export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Runs a list of async task factories with a bounded maximum concurrency limit.
 */
export async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrencyLimit: number = 3
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < tasks.length) {
      const idx = currentIndex++;
      const task = tasks[idx];
      if (task) {
        results[idx] = await task();
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrencyLimit, tasks.length) },
    () => worker()
  );

  await Promise.all(workers);
  return results;
}
