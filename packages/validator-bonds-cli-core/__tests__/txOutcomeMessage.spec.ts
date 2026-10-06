import { txOutcomeMessage } from '../src/utils'

describe('txOutcomeMessage', () => {
  it('marks a dry run upfront so the success wording cannot be read as done', () => {
    expect(txOutcomeMessage(true, 'Bond account B1 successfully created')).toBe(
      'DRY RUN (nothing sent on-chain): Bond account B1 successfully created',
    )
  })

  it('leaves the message untouched for an executed transaction', () => {
    expect(
      txOutcomeMessage(false, 'Bond account B1 successfully created'),
    ).toBe('Bond account B1 successfully created')
  })
})
