/**
 * Race a promise against a timeout, returning `fallback` if the timeout wins or
 * the operation rejects. The timer is unref'd so it never keeps the process
 * alive, and always cleared once the race settles. Use for best-effort I/O that
 * must not block the CLI (banner fetches, epoch lookups, notifications).
 */
export async function raceWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>(resolve => {
    timer = setTimeout(() => resolve(fallback), timeoutMs)
    timer.unref()
  })
  try {
    return await Promise.race([operation, timeout])
  } catch {
    return fallback
  } finally {
    if (timer) clearTimeout(timer)
  }
}
