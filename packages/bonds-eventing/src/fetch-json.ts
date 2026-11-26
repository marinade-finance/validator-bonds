export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) {
    throw new Error(`GET ${url} failed: HTTP ${response.status}`)
  }
  return (await response.json()) as T
}
