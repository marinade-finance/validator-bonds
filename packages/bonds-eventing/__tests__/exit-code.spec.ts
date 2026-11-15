import {
  BackendTerminatedError,
  BackendTerminatedUnexpectedlyError,
  ConnectionError,
} from 'slonik'

import { UndeliveredEventsError, exitCodeFor } from '../src/exit-code'

describe('exitCodeFor', () => {
  it('maps undelivered events to 99', () => {
    expect(exitCodeFor(new UndeliveredEventsError('pending left'))).toBe(99)
  })

  it('maps transient DB errors to 100', () => {
    const cause = new Error('connection lost')
    expect(exitCodeFor(new ConnectionError('connection refused'))).toBe(100)
    expect(exitCodeFor(new BackendTerminatedError(cause))).toBe(100)
    expect(exitCodeFor(new BackendTerminatedUnexpectedlyError(cause))).toBe(100)
  })

  it('maps a refused or dropped connection to 100', () => {
    for (const code of ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT']) {
      const err = Object.assign(new Error(`connect ${code}`), { code })
      expect([code, exitCodeFor(err)]).toEqual([code, 100])
    }
  })

  it('maps every other error to 200', () => {
    expect(exitCodeFor(new Error('boom'))).toBe(200)
    expect(
      exitCodeFor(Object.assign(new Error('missing'), { code: 'ENOENT' })),
    ).toBe(200)
    expect(exitCodeFor('not an error')).toBe(200)
  })
})
