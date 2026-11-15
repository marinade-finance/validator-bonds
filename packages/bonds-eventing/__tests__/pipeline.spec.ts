import pino from 'pino'

import { runEventingPipeline } from '../src/pipeline'

import type { BondsEventV1, EventingConfig, ValidatorState } from '../src/types'

const logger = pino({ level: 'silent' })

const config: EventingConfig = {
  bondsApiUrl: '',
  validatorsApiUrl: '',
  scoringApiUrl: '',
  tvlApiUrl: '',
  institutionalApiUrl: '',
  postgresUrl: undefined,
  postgresSslRootCert: undefined,
  dryRun: false,
  cacheInputs: undefined,
}

describe('runEventingPipeline without postgres', () => {
  it('evaluates against empty state and never calls the network', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch')
    const evaluate = jest.fn(
      (_v: unknown[], _s: Map<string, ValidatorState>) => [] as BondsEventV1[],
    )

    await runEventingPipeline({
      bondType: 'bidding',
      config,
      logger,
      validators: [{ voteAccount: 'voteA' }],
      epoch: 900,
      voteAccountOf: v => v.voteAccount,
      evaluate,
      toState: () => {
        throw new Error('state must not be built without postgres')
      },
    })

    expect(evaluate).toHaveBeenCalledTimes(1)
    expect(evaluate.mock.calls[0]![1].size).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
