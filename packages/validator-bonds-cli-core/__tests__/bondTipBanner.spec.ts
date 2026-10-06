import {
  augmentAuctionResult,
  getValidatorTip,
  selectRedelegationPriorityFrontierPmpe,
} from '@marinade.finance/ds-sam-calc'
import { PublicKey } from '@solana/web3.js'

import {
  maybePrintBondTipBanner,
  metaToConfig,
  reconstructAuctionResult,
} from '../src/bondTipBanner'

import type {
  AuctionContextResponse,
  AuctionMetaResponse,
} from '../src/bondTipBanner'

const VOTE = new PublicKey('11111111111111111111111111111112')
const OTHER = new PublicKey('11111111111111111111111111111113')

const META: AuctionMetaResponse = {
  epoch: 700,
  winningTotalPmpe: 3.0,
  marinadeSamTvlSol: 1_000_000,
  minBondEpochs: 4,
  idealBondEpochs: 12,
  minBondBalanceSol: 1,
  bondRiskFeeMult: 0,
  bidTooLowPenaltyHistoryEpochs: 3,
  bidTooLowPenaltyPermittedDeviationPmpe: 0.05,
  minMaxStakeWanted: 100,
  blacklist: [],
}

function makeBlob(
  voteAccount: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    voteAccount,
    bondBalanceSol: 500,
    claimableBondBalanceSol: 500,
    marinadeActivatedStakeSol: 50_000,
    unprotectedStakeSol: 0,
    maxStakeWanted: 50_000,
    samEligible: true,
    samBlocked: false,
    minBondPmpe: 3.0,
    idealBondPmpe: 12.0,
    minUnprotectedReserve: 0,
    idealUnprotectedReserve: 0,
    bondGoodForNEpochs: 20,
    unstakePriority: 0,
    auctionStake: { marinadeSamTargetSol: 50_000 },
    bondForcedUndelegation: { value: null },
    revShare: {
      totalPmpe: 3.5,
      inflationPmpe: 2.0,
      mevPmpe: 0.5,
      bidPmpe: 1.0,
      blockPmpe: 0,
      onchainDistributedPmpe: 2.0,
      bondObligationPmpe: 0.5,
      auctionEffectiveStaticBidPmpe: 1.0,
      auctionEffectiveBidPmpe: 1.0,
      activatingStakePmpe: 0,
      bidTooLowPenaltyPmpe: 0,
      effParticipatingBidPmpe: 1.0,
      expectedMaxEffBidPmpe: 1.0,
      blacklistPenaltyPmpe: 0,
    },
    values: { bondRiskFeeSol: 0, paidUndelegationSol: 0 },
    lastCapConstraint: {
      constraintType: 'WANT',
      constraintName: 'maxStakeWanted',
      totalStakeSol: 50_000,
      totalLeftToCapSol: 0,
      marinadeStakeSol: 50_000,
      marinadeLeftToCapSol: 0,
    },
    auctions: [{ bidPmpe: 1.0, effParticipatingBidPmpe: 1.0 }],
    ...overrides,
  }
}

function makeContext(): AuctionContextResponse {
  return {
    auction_meta: META,
    auction_validators: {
      [VOTE.toBase58()]: makeBlob(VOTE.toBase58()),
      [OTHER.toBase58()]: makeBlob(OTHER.toBase58(), {
        marinadeActivatedStakeSol: 30_000,
        auctionStake: { marinadeSamTargetSol: 30_000 },
      }),
    },
  }
}

function mockFetch(body: unknown, ok = true): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch
}

describe('maybePrintBondTipBanner', () => {
  let errSpy: jest.SpyInstance
  const origFetch = global.fetch

  beforeEach(() => {
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    errSpy.mockRestore()
    global.fetch = origFetch
    jest.restoreAllMocks()
  })

  const call = (
    overrides: Partial<Parameters<typeof maybePrintBondTipBanner>[0]> = {},
  ) =>
    maybePrintBondTipBanner({
      apiUrl: 'https://api.example',
      enabled: true,
      voteAccount: VOTE,
      ...overrides,
    })

  it('prints the banner with the exact tip ds-sam-calc computes', async () => {
    const context = makeContext()
    mockFetch(context)

    // Independently compute the tip the dashboard would show for this fixture.
    const result = reconstructAuctionResult(context, META)
    const config = metaToConfig(META)
    const augmented = augmentAuctionResult(result, config.minBondBalanceSol)
    const me = augmented.find(v => v.voteAccount === VOTE.toBase58())!
    const expected = getValidatorTip(
      me,
      config,
      META.winningTotalPmpe,
      undefined,
      result.auctionData.blacklist,
      selectRedelegationPriorityFrontierPmpe(result, config.minBondBalanceSol),
    )

    await call()

    expect(errSpy).toHaveBeenCalledTimes(1)
    const output = errSpy.mock.calls[0][0] as string
    expect(output).toContain('Marinade Stake Auction')
    expect(output).toContain(expected.text)
  })

  it('applies the fresh bondBalanceSol override to the computed tip', async () => {
    // A critically underfunded bond against real stake — the override must flow
    // into the coverage math so the banner reflects the fresh (low) balance.
    const context = makeContext()
    mockFetch(context)

    const withOverride = reconstructAuctionResult(
      {
        ...context,
        auction_validators: {
          ...context.auction_validators,
          [VOTE.toBase58()]: {
            ...context.auction_validators[VOTE.toBase58()],
            bondBalanceSol: 0.5,
            claimableBondBalanceSol: 0.5,
          },
        },
      },
      META,
    )
    const config = metaToConfig(META)
    const augmented = augmentAuctionResult(
      withOverride,
      config.minBondBalanceSol,
    )
    const me = augmented.find(v => v.voteAccount === VOTE.toBase58())!
    const expected = getValidatorTip(
      me,
      config,
      META.winningTotalPmpe,
      undefined,
      withOverride.auctionData.blacklist,
      selectRedelegationPriorityFrontierPmpe(
        withOverride,
        config.minBondBalanceSol,
      ),
    )

    await call({ bondBalanceSol: 0.5, claimableBondBalanceSol: 0.5 })

    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(errSpy.mock.calls[0][0] as string).toContain(expected.text)
  })

  it('applies a zero fresh balance (empty stake accounts) over a positive snapshot', async () => {
    // An empty fresh stake-account result is a genuine zero balance, so the
    // caller passes 0 (not undefined). The override must flow through and not be
    // dropped as falsy, so the tip reflects the drained bond, not the stale 500.
    const context = makeContext()
    mockFetch(context)

    const zeroed = reconstructAuctionResult(
      {
        ...context,
        auction_validators: {
          ...context.auction_validators,
          [VOTE.toBase58()]: {
            ...context.auction_validators[VOTE.toBase58()],
            bondBalanceSol: 0,
            claimableBondBalanceSol: 0,
          },
        },
      },
      META,
    )
    const config = metaToConfig(META)
    const augmented = augmentAuctionResult(zeroed, config.minBondBalanceSol)
    const me = augmented.find(v => v.voteAccount === VOTE.toBase58())!
    const expected = getValidatorTip(
      me,
      config,
      META.winningTotalPmpe,
      undefined,
      zeroed.auctionData.blacklist,
      selectRedelegationPriorityFrontierPmpe(zeroed, config.minBondBalanceSol),
    )

    const snapshot = reconstructAuctionResult(context, META)
    const snapshotAugmented = augmentAuctionResult(
      snapshot,
      config.minBondBalanceSol,
    )
    const snapshotMe = snapshotAugmented.find(
      v => v.voteAccount === VOTE.toBase58(),
    )!
    const snapshotTip = getValidatorTip(
      snapshotMe,
      config,
      META.winningTotalPmpe,
      undefined,
      snapshot.auctionData.blacklist,
      selectRedelegationPriorityFrontierPmpe(
        snapshot,
        config.minBondBalanceSol,
      ),
    )
    expect(expected.text).not.toEqual(snapshotTip.text)

    await call({ bondBalanceSol: 0, claimableBondBalanceSol: 0 })

    expect(errSpy).toHaveBeenCalledTimes(1)
    expect(errSpy.mock.calls[0][0] as string).toContain(expected.text)
  })

  it('is a no-op when the auction meta is absent (field omitted on the wire)', async () => {
    // The API omits auction_meta (skip_serializing_if) rather than sending null.
    mockFetch({ auction_validators: {} })
    await call()
    expect(errSpy).not.toHaveBeenCalled()
  })

  it('is a no-op when the validator is not in the auction', async () => {
    const context = makeContext()
    delete context.auction_validators[VOTE.toBase58()]
    mockFetch(context)
    await call()
    expect(errSpy).not.toHaveBeenCalled()
  })

  it('is a no-op when disabled or the vote account is missing', async () => {
    mockFetch(makeContext())
    await call({ enabled: false })
    await call({ voteAccount: undefined })
    expect(errSpy).not.toHaveBeenCalled()
  })

  it('does not throw and stays silent when the fetch fails', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('network down')) as unknown as typeof fetch
    await expect(call()).resolves.toBeUndefined()
    expect(errSpy).not.toHaveBeenCalled()
  })
})
