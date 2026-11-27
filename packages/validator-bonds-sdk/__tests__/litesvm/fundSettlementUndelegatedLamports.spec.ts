import { signer } from '@marinade.finance/web3js-1x'
import { LAMPORTS_PER_SOL, SystemProgram } from '@solana/web3.js'

import {
  currentEpoch,
  executeIx,
  initLiteSvmTest,
  warpToNextEpoch,
} from './litesvm'
import {
  deserializeStakeState,
  fundSettlementInstruction,
  getConfig,
  getRentExemptStake,
  getSettlement,
  minimalSizeStakeAccount,
  refundBondBalanceInstruction,
} from '../../src'
import {
  createBondsFundedStakeAccount,
  createVoteAccount,
} from '../utils/staking'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'

import type { LiteSvmProvider } from './litesvm'
import type { ValidatorBondsProgram } from '../../src'
import type { Keypair, PublicKey } from '@solana/web3.js'

// Funding a settlement from a bond stake account that holds lamports which are
// not delegated (refund_bond_balance, or a plain transfer to the stake account).
//
// fund_settlement withdraws the not delegated lamports to the split account first
// and then splits the rest of the delegation from the funded account. The stake
// program rejects a split when the split-off delegation is under the minimum
// delegation (1 SOL at mainnet).
// When delegation is in range (minimal stake + rent, minimal stake + rent + 1 SOL)
// the split amount is under 1 SOL and the stake program fails with
// InsufficientDelegation (0xc).
describe('Validator Bonds fund settlement with not delegated lamports', () => {
  let provider: LiteSvmProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let operatorAuthority: Keypair
  let bondAccount: PublicKey
  let voteAccount: PublicKey
  let rentExemptStake: number
  let minimalStake: number
  let minimalStakeAccountSize: number

  beforeAll(async () => {
    ;({ provider, program } = initLiteSvmTest())
    rentExemptStake = await getRentExemptStake(provider)
  })

  beforeEach(async () => {
    ;({ configAccount, operatorAuthority } = await executeInitConfigInstruction(
      { program, provider, epochsToClaimSettlement: 3 },
    ))
    const config = await getConfig(program, configAccount)
    minimalStake = config.minimumStakeLamports.toNumber()
    minimalStakeAccountSize = minimalSizeStakeAccount(
      config.minimumStakeLamports,
    ).toNumber()
    let validatorIdentity: Keypair
    ;({ voteAccount, validatorIdentity } = await createVoteAccount({
      provider,
    }))
    ;({ bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
      validatorIdentity,
    }))
  })

  async function lamportsOf(address: PublicKey): Promise<number> {
    return (await provider.connection.getAccountInfo(address))?.lamports ?? 0
  }

  async function delegationOf(address: PublicKey): Promise<number> {
    const info = await provider.connection.getAccountInfo(address)
    const state = deserializeStakeState(info?.data)
    return Number(state.Stake?.stake.delegation.stake ?? 0)
  }

  /** Activated bond stake account with the delegation and not delegated lamports on top. */
  async function createStakeAccount({
    delegation,
    notDelegated,
    viaRefund,
  }: {
    delegation: number
    notDelegated: number
    viaRefund: boolean
  }): Promise<PublicKey> {
    const stakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      lamports: delegation + rentExemptStake,
      voteAccount,
    })
    await warpToNextEpoch(provider)
    expect(await delegationOf(stakeAccount)).toEqual(delegation)
    if (notDelegated > 0) {
      await provider.sendIx(
        [],
        SystemProgram.transfer({
          fromPubkey: provider.walletPubkey,
          toPubkey: viaRefund ? bondAccount : stakeAccount,
          lamports: notDelegated,
        }),
      )
      if (viaRefund) {
        const { instruction } = await refundBondBalanceInstruction({
          program,
          configAccount,
          bondAccount,
          stakeAccount,
        })
        await provider.sendIx([], instruction)
      }
    }
    expect(await lamportsOf(stakeAccount)).toEqual(
      delegation + rentExemptStake + notDelegated,
    )
    expect(await delegationOf(stakeAccount)).toEqual(delegation)
    return stakeAccount
  }

  /** Funding has to pass and the settlement has to be funded with the whole claim amount. */
  async function fundSettlement(
    stakeAccount: PublicKey,
    maxTotalClaim: number,
  ) {
    const { settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: await currentEpoch(provider),
      maxTotalClaim,
    })
    const { instruction, splitStakeAccount } = await fundSettlementInstruction({
      program,
      settlementAccount,
      stakeAccount,
    })
    await executeIx(
      provider,
      [provider.wallet, signer(splitStakeAccount), operatorAuthority],
      instruction,
    )
    const settlement = await getSettlement(program, settlementAccount)
    expect(Number(settlement.lamportsFunded)).toEqual(maxTotalClaim)
  }

  // not delegated lamports are part of the bond funding and a settlement can take them
  it.each([
    // [delegation SOL, not delegated SOL, claim SOL]
    [10, 100, 5], // not delegated over the claim: withdraw + split
    [1000, 3, 5], // not delegated under the claim: split only
    [10, 100, 50], // claim over the delegation, paid from not delegated lamports
  ])(
    'fund settlement, delegation %d SOL, refunded %d SOL, claim %d SOL',
    async (delegationSol, notDelegatedSol, claimSol) => {
      const stakeAccount = await createStakeAccount({
        delegation: delegationSol * LAMPORTS_PER_SOL,
        notDelegated: notDelegatedSol * LAMPORTS_PER_SOL,
        viaRefund: true,
      })
      await fundSettlement(stakeAccount, claimSol * LAMPORTS_PER_SOL)
    },
  )

  it('fund settlement at borders of the small delegation range', async () => {
    const lowerBorder = minimalStake + rentExemptStake
    for (const delegation of [lowerBorder, lowerBorder + LAMPORTS_PER_SOL]) {
      const stakeAccount = await createStakeAccount({
        delegation,
        notDelegated: 10 * LAMPORTS_PER_SOL,
        viaRefund: true,
      })
      await fundSettlement(stakeAccount, 5 * LAMPORTS_PER_SOL)
    }
  })

  // KNOWN ISSUE: the tests below describe the expected behaviour, they fail now
  // on the stake program error InsufficientDelegation (0xc) at fund_settlement.
  // `it.failing` reports an error when the test starts passing;
  // change it to `it` when fund_settlement is fixed.
  describe('small delegation with not delegated lamports over the claim', () => {
    it.failing(
      'fund settlement, delegation 1.5 SOL, refunded 10 SOL',
      async () => {
        const stakeAccount = await createStakeAccount({
          delegation: 1.5 * LAMPORTS_PER_SOL,
          notDelegated: 10 * LAMPORTS_PER_SOL,
          viaRefund: true,
        })
        await fundSettlement(stakeAccount, 5 * LAMPORTS_PER_SOL)
      },
    )

    it.failing(
      'fund settlement, delegation 1.5 SOL, 10 SOL transferred directly',
      async () => {
        const stakeAccount = await createStakeAccount({
          delegation: 1.5 * LAMPORTS_PER_SOL,
          notDelegated: 10 * LAMPORTS_PER_SOL,
          viaRefund: false,
        })
        await fundSettlement(stakeAccount, 5 * LAMPORTS_PER_SOL)
      },
    )

    it.failing(
      'fund settlement, delegation just over lower border',
      async () => {
        const stakeAccount = await createStakeAccount({
          delegation: minimalStake + rentExemptStake + 1,
          notDelegated: 10 * LAMPORTS_PER_SOL,
          viaRefund: true,
        })
        await fundSettlement(stakeAccount, 5 * LAMPORTS_PER_SOL)
      },
    )

    it.failing(
      'fund settlement, delegation just under upper border',
      async () => {
        const stakeAccount = await createStakeAccount({
          delegation: minimalStake + rentExemptStake + LAMPORTS_PER_SOL - 1,
          notDelegated: 10 * LAMPORTS_PER_SOL,
          viaRefund: true,
        })
        await fundSettlement(stakeAccount, 5 * LAMPORTS_PER_SOL)
      },
    )

    // stake account of a closed settlement after reset_stake:
    // delegation is the minimal stake account size
    it.failing(
      'fund settlement, delegation of minimal stake account size',
      async () => {
        const stakeAccount = await createStakeAccount({
          delegation: minimalStakeAccountSize,
          notDelegated: 10 * LAMPORTS_PER_SOL,
          viaRefund: true,
        })
        await fundSettlement(stakeAccount, 5 * LAMPORTS_PER_SOL)
      },
    )
  })
})
