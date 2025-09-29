import assert from 'assert'

import { verifyError } from '@marinade.finance/anchor-common'
import { assertNotExist, currentEpoch } from '@marinade.finance/bankrun-utils'
import { createUserAndFund } from '@marinade.finance/web3js-1x'
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js'

import { initBankrunTest } from './bankrun'
import {
  Errors,
  cancelSettlementInstruction,
  closeSettlementV2Instruction,
  configureConfigInstruction,
  getSettlement,
} from '../../src'
import { getRentExempt } from '../utils/helpers'
import { createVoteAccount } from '../utils/staking'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'

import type { ValidatorBondsProgram } from '../../src'
import type { BankrunExtendedProvider } from '@marinade.finance/bankrun-utils'
import type { PublicKey } from '@solana/web3.js'

describe('Validator Bonds cancel settlement', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let adminAuthority: Keypair
  let operatorAuthority: Keypair
  let validatorIdentity: Keypair
  let voteAccount: PublicKey
  let settlementAccount: PublicKey
  let settlementClaimsAccount: PublicKey
  let rentExemptSettlement: number
  let rentExemptSettlementClaims: number
  let settlementEpoch: bigint
  let rentCollector: Keypair

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
  })

  beforeEach(async () => {
    ;({ configAccount, operatorAuthority, adminAuthority } =
      await executeInitConfigInstruction({
        program,
        provider,
        // big number that will not be reached in the test
        // and the close settlement will fail on that
        epochsToClaimSettlement: 1_000,
      }))
    ;({ voteAccount, validatorIdentity } = await createVoteAccount({
      provider,
    }))
    const { bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
      validatorIdentity,
    })
    settlementEpoch = await currentEpoch(provider)
    rentCollector = Keypair.generate()
    await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL,
      user: rentCollector,
    })
    ;({ settlementAccount, settlementClaimsAccount } =
      await executeInitSettlement({
        configAccount,
        program,
        provider,
        voteAccount,
        operatorAuthority,
        currentEpoch: settlementEpoch,
        rentCollector: rentCollector.publicKey,
      }))
    rentExemptSettlement = await getRentExempt(provider, settlementAccount)
    rentExemptSettlementClaims = await getRentExempt(
      provider,
      settlementClaimsAccount,
    )
    const settlementData = await getSettlement(program, settlementAccount)
    assert(bondAccount.toBase58() === settlementData.bond.toBase58())
  })

  it('cancel settlement with operator authority', async () => {
    const { instruction } = await cancelSettlementInstruction({
      program,
      settlementAccount,
      rentCollector: rentCollector.publicKey,
      authority: operatorAuthority,
    })
    await provider.sendIx([operatorAuthority], instruction)
    await assertNotExist(provider, settlementAccount)

    const rentCollectorInfo = await provider.connection.getAccountInfo(
      rentCollector.publicKey,
    )
    assert(rentCollectorInfo !== null)
    expect(rentCollectorInfo.lamports).toEqual(
      LAMPORTS_PER_SOL + rentExemptSettlement + rentExemptSettlementClaims,
    )
  })

  it('cancel settlement with pause authority', async () => {
    const pauseAuthority = Keypair.generate()
    const { instruction: configureConfigIx } = await configureConfigInstruction(
      {
        program,
        configAccount: configAccount,
        newPauseAuthority: pauseAuthority.publicKey,
      },
    )
    await provider.sendIx([adminAuthority], configureConfigIx)

    const { instruction } = await cancelSettlementInstruction({
      program,
      settlementAccount,
      rentCollector: rentCollector.publicKey,
      authority: pauseAuthority,
    })

    await provider.sendIx([pauseAuthority], instruction)
    await assertNotExist(provider, settlementAccount)

    const rentCollectorInfo = await provider.connection.getAccountInfo(
      rentCollector.publicKey,
    )
    assert(rentCollectorInfo !== null)
    expect(rentCollectorInfo.lamports).toEqual(
      LAMPORTS_PER_SOL + rentExemptSettlement + rentExemptSettlementClaims,
    )
  })

  it('cannot cancel with wrong authority', async () => {
    const wrongAuthority = Keypair.generate()
    const { instruction } = await cancelSettlementInstruction({
      program,
      settlementAccount,
      rentCollector: rentCollector.publicKey,
      authority: wrongAuthority,
    })
    try {
      await provider.sendIx([wrongAuthority], instruction)
      throw new Error('failure; expected wrong authority')
    } catch (e) {
      verifyError(
        e,
        Errors,
        6060,
        'permitted only to operator or pause authority',
      )
    }
    expect(
      await provider.connection.getAccountInfo(settlementAccount),
    ).not.toBeNull()
  })

  it('cannot close settlement when not expired', async () => {
    const { instruction } = await closeSettlementV2Instruction({
      program,
      settlementAccount,
    })
    try {
      await provider.sendIx([], instruction)
      throw new Error('failure expected; settlement has not expired yet')
    } catch (e) {
      verifyError(e, Errors, 6022, 'has not expired yet')
    }
  })
})
