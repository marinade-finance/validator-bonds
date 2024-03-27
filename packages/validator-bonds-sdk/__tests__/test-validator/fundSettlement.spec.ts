import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  FUND_SETTLEMENT_EVENT,
  fundSettlementInstruction,
  bondsWithdrawerAuthority,
  getConfig,
  parseCpiEvents,
  assertEvent,
} from '../../src'
import { initTest } from './testValidator'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'
import { executeTxSimple, transaction } from '@marinade.finance/web3js-common'
import {
  authorizeStakeAccount,
  delegatedStakeAccount,
  getRentExemptStake,
} from '../utils/staking'
import {
  createUserAndFund,
  pubkey,
  signer,
} from '@marinade.finance/web3js-common'
import {
  AnchorExtendedProvider,
  getAnchorValidatorInfo,
} from '@marinade.finance/anchor-common'
import assert from 'assert'

describe('Validator Bonds fund settlement', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let operatorAuthority: Keypair
  let validatorIdentity: Keypair
  let voteAccount: PublicKey
  let bondAccount: PublicKey

  beforeAll(async () => {
    ;({ provider, program } = await initTest())
    ;({ validatorIdentity } = await getAnchorValidatorInfo(provider.connection))
  })

  beforeEach(async () => {
    ;({ configAccount, operatorAuthority } = await executeInitConfigInstruction(
      {
        program,
        provider,
        epochsToClaimSettlement: 0,
      }
    ))
    ;({ voteAccount, bondAccount } = await executeInitBondInstruction({
      configAccount,
      program,
      provider,
      validatorIdentity,
    }))
  })

  it('fund settlement', async () => {
    const rentCollector = Keypair.generate()
    const { settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      rentCollector: rentCollector.publicKey,
      maxTotalClaim: 2 * LAMPORTS_PER_SOL,
    })
    const fundedAmount = 10 * LAMPORTS_PER_SOL
    const { stakeAccount, withdrawer: initWithdrawer } =
      await delegatedStakeAccount({
        provider,
        lamports: fundedAmount,
        voteAccountToDelegate: voteAccount,
      })
    // not needed to activate for this test case
    const [bondsAuth] = bondsWithdrawerAuthority(
      configAccount,
      program.programId
    )
    await authorizeStakeAccount({
      provider,
      authority: initWithdrawer,
      stakeAccount: stakeAccount,
      withdrawer: bondsAuth,
      staker: bondsAuth,
    })

    const splitRentPayer = await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL,
    })

    const tx = await transaction(provider)

    const { instruction, splitStakeAccount } = await fundSettlementInstruction({
      program,
      settlementAccount,
      stakeAccount,
      splitStakeRentPayer: splitRentPayer,
    })
    tx.add(instruction)

    const executionReturn = await executeTxSimple(provider.connection, tx, [
      provider.wallet,
      operatorAuthority,
      signer(splitStakeAccount),
      signer(splitRentPayer),
    ])

    const rentExemptStake = await getRentExemptStake(provider)
    const minimalStakeAccountSize =
      rentExemptStake +
      (await getConfig(program, configAccount)).minimumStakeLamports.toNumber()

    const events = parseCpiEvents(program, executionReturn?.response)
    const e = assertEvent(events, FUND_SETTLEMENT_EVENT)
    assert(e !== undefined)
    expect(e.settlement).toEqual(settlementAccount)
    expect(e.bond).toEqual(bondAccount)
    expect(e.fundingAmount).toEqual(2 * LAMPORTS_PER_SOL)
    expect(e.lamportsClaimed).toEqual(0)
    expect(e.merkleNodesClaimed).toEqual(0)
    expect(e.splitRentAmount).toEqual(rentExemptStake)
    expect(e.splitRentCollector).toEqual(pubkey(splitRentPayer))
    expect(e.splitStakeAccount?.address).toEqual(pubkey(splitStakeAccount))
    expect(e.splitStakeAccount?.amount).toEqual(
      fundedAmount - 2 * LAMPORTS_PER_SOL - minimalStakeAccountSize
    )
  })
})
