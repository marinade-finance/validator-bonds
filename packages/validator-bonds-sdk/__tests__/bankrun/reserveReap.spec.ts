import {
  assertNotExist,
  currentEpoch,
  warpOffsetEpoch,
} from '@marinade.finance/bankrun-utils'
import { createUserAndFund, pubkey } from '@marinade.finance/web3js-1x'
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js'
import BN from 'bn.js'

import { initBankrunTest } from './bankrun'
import {
  closeSettlementV2Instruction,
  getSettlement,
  withdrawStakeInstruction,
} from '../../src'
import {
  MERKLE_ROOT_VOTE_ACCOUNT_2_BUF,
  totalClaimVoteAccount2,
} from '../utils/merkleTreeTestData'
import {
  createSettlementFundedInitializedStake,
  createVoteAccount,
} from '../utils/staking'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'

import type { ValidatorBondsProgram } from '../../src'
import type { BankrunExtendedProvider } from '@marinade.finance/bankrun-utils'
import type { PublicKey } from '@solana/web3.js'

// Reserve front (Coord Goal 2) money-flow, end to end at the program level:
// init inflates the on-chain max_total_claim by R, the reserve fronts R from
// marinade_wallet as an undelegated stake, and the unclaimed R is reaped back to
// marinade_wallet at close. The merkle root still commits only to the real claims
// (sum C), so R is never claimable and the reserve is made whole at close.
describe('Validator Bonds reserve front reap', () => {
  const epochsToClaimSettlement = 1
  const reserveFront = 2 * LAMPORTS_PER_SOL // R
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let operatorAuthority: Keypair
  let voteAccount: PublicKey
  let validatorIdentity: Keypair

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
  })

  beforeEach(async () => {
    ;({ configAccount, operatorAuthority } = await executeInitConfigInstruction(
      {
        program,
        provider,
        epochsToClaimSettlement,
      },
    ))
    ;({ voteAccount, validatorIdentity } = await createVoteAccount({
      provider,
    }))
    await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
      validatorIdentity,
    })
  })

  it('inflates max by R and reaps the front to marinade_wallet at close', async () => {
    // Real claim sum C (committed by the merkle root) and the inflated max C + R.
    const realClaimSum = totalClaimVoteAccount2
    const maxTotalClaim = realClaimSum.add(new BN(reserveFront))
    const rentCollector = Keypair.generate()

    const { settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: await currentEpoch(provider),
      rentCollector: rentCollector.publicKey,
      merkleRoot: MERKLE_ROOT_VOTE_ACCOUNT_2_BUF,
      maxMerkleNodes: 5,
      maxTotalClaim,
    })

    // init set the on-chain max to exactly C + R
    const settlement = await getSettlement(program, settlementAccount)
    expect(settlement.maxTotalClaim.toString()).toEqual(
      maxTotalClaim.toString(),
    )

    // the reserve front: an undelegated stake of R funded to the settlement
    const reserveStake = await createSettlementFundedInitializedStake({
      program,
      provider,
      configAccount,
      settlementAccount,
      lamports: reserveFront,
    })

    // marinade_wallet funds the front; the reap must make it whole again
    const marinadeWallet = await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL,
    })

    // close needs the claim window to have passed
    await warpOffsetEpoch(provider, epochsToClaimSettlement + 1)
    const { instruction: closeIx } = await closeSettlementV2Instruction({
      program,
      settlementAccount,
      rentCollector: rentCollector.publicKey,
    })
    await provider.sendIx([], closeIx)
    await assertNotExist(provider, settlementAccount)

    // reap: the unclaimed reserve stake is withdrawn back to marinade_wallet
    const { instruction: withdrawIx } = await withdrawStakeInstruction({
      program,
      configAccount,
      stakeAccount: reserveStake,
      operatorAuthority: operatorAuthority.publicKey,
      settlementAccount,
      withdrawTo: pubkey(marinadeWallet),
    })
    await provider.sendIx([operatorAuthority], withdrawIx)
    await assertNotExist(provider, reserveStake)

    // marinade recovers exactly the fronted R (the reserve stake's full balance)
    expect(
      (await provider.connection.getAccountInfo(pubkey(marinadeWallet)))
        ?.lamports,
    ).toEqual(LAMPORTS_PER_SOL + reserveFront)
  })
})
