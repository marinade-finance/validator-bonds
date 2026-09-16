const REQUEST_TIMEOUT_MS = 30_000

/** The body is whatever JSON the store held: a caller narrows it itself. */
export interface DirectoryDoc {
  body: unknown
  etag: string
}

export interface CreatePrecondition {
  create: true
}

export interface MatchPrecondition {
  ifMatch: string
}

export type PutPrecondition = CreatePrecondition | MatchPrecondition

/** A write the store refused because the document is not in the expected version (HTTP 412). */
export class DirectoryConflictError extends Error {
  constructor(readonly path: string) {
    super(`Precondition failed writing ${path}`)
    this.name = 'DirectoryConflictError'
  }
}

export interface Directory {
  get(path: string): Promise<DirectoryDoc | null>
  put(
    path: string,
    body: unknown,
    precondition: PutPrecondition,
  ): Promise<string>
  ready(): Promise<void>
}

function preconditionHeader(precondition: PutPrecondition): [string, string] {
  return 'create' in precondition
    ? ['If-None-Match', '*']
    : ['If-Match', precondition.ifMatch]
}

async function failed(
  method: string,
  path: string,
  response: Response,
): Promise<Error> {
  const body = await response.text().catch(() => '')
  return new Error(
    `Directory ${method} ${path} failed: HTTP ${response.status} ${body}`,
  )
}

/**
 * Client for marinade-directory, a versioned JSON document store. Paths are
 * store paths (`/bonds/eventing/bidding`), not URLs — the `/v1` prefix and the
 * bearer token belong to the client.
 */
export function createDirectory(url: string, token: string): Directory {
  const base = url.replace(/\/+$/, '')
  const authorization = `Bearer ${token}`

  return {
    async get(path: string): Promise<DirectoryDoc | null> {
      const response = await fetch(`${base}/v1${path}`, {
        headers: { Authorization: authorization },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })

      if (response.status === 404) return null
      if (!response.ok) throw await failed('GET', path, response)

      const etag = response.headers.get('etag')
      if (etag === null)
        throw new Error(`Directory GET ${path} answered without an ETag`)

      const body: unknown = await response.json()
      return { body, etag }
    },

    async put(
      path: string,
      body: unknown,
      precondition: PutPrecondition,
    ): Promise<string> {
      const [name, value] = preconditionHeader(precondition)
      const response = await fetch(`${base}/v1${path}`, {
        method: 'PUT',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
          [name]: value,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })

      if (response.status === 412) throw new DirectoryConflictError(path)
      if (!response.ok) throw await failed('PUT', path, response)

      const etag = response.headers.get('etag')
      if (etag === null)
        throw new Error(`Directory PUT ${path} answered without an ETag`)

      return etag
    },

    async ready(): Promise<void> {
      const response = await fetch(`${base}/ready`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) throw await failed('GET', '/ready', response)
    },
  }
}
