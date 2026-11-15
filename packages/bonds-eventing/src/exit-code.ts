import {
  BackendTerminatedError,
  BackendTerminatedUnexpectedlyError,
  ConnectionError,
} from 'slonik'

export class UndeliveredEventsError extends Error {}

// slonik passes a refused or dropped socket through as a plain Node error
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  'EPIPE',
])

/** Exit codes: 99 = events left undelivered, 100 = transient DB error (retriable), 200 = any other error. */
export function exitCodeFor(err: unknown): number {
  if (err instanceof UndeliveredEventsError) {
    return 99
  }
  if (
    err instanceof ConnectionError ||
    err instanceof BackendTerminatedError ||
    err instanceof BackendTerminatedUnexpectedlyError ||
    (err instanceof Error &&
      TRANSIENT_NETWORK_CODES.has((err as NodeJS.ErrnoException).code ?? ''))
  ) {
    return 100
  }
  return 200
}
