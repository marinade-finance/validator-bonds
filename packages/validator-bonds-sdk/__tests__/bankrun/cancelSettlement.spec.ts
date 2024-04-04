import {
  Errors,
  ValidatorBondsProgram,
  cancelSettlementInstruction,
  closeSettlementInstruction,
  configureConfigInstruction,
  getSettlement,
} from '../../src'
import {
  BankrunExtendedProvider,
  assertNotExist,
  currentEpoch,
} from '@marinade.finance/bankrun-utils'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { createVoteAccount } from '../utils/staking'
import { getRentExempt } from '../utils/helpers'
import assert from 'assert'
import { createUserAndFund } from '@marinade.finance/web3js-common'
import { verifyError } from '@marinade.finance/anchor-common'
import { initBankrunTest } from './bankrun'

describe('Validator Bonds cancel settlement', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let adminAuthority: Keypair
  let operatorAuthority: Keypair
  let validatorIdentity: Keypair
  let voteAccount: PublicKey
  let settlementAccount: PublicKey
  let rentExemptSettlement: number
  let settlementEpoch: number
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
    ;({ settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: settlementEpoch,
      rentCollector: rentCollector.publicKey,
    }))
    rentExemptSettlement = await getRentExempt(provider, settlementAccount)
    const settlementData = await getSettlement(program, settlementAccount)
    expect(bondAccount).toEqual(settlementData.bond)
  })

  it('cancel settlement with operator authority', async () => {
    const { instruction } = await cancelSettlementInstruction({
      program,
      settlementAccount,
      rentCollector: rentCollector.publicKey,
      authority: operatorAuthority,
    })
    await provider.sendIx([operatorAuthority], instruction)
    assertNotExist(provider, settlementAccount)

    const rentCollectorInfo = await provider.connection.getAccountInfo(
      rentCollector.publicKey
    )
    assert(rentCollectorInfo !== null)
    expect(rentCollectorInfo.lamports).toEqual(
      LAMPORTS_PER_SOL + rentExemptSettlement
    )
  })

  it('cancel settlement with pause authority', async () => {
    const pauseAuthority = Keypair.generate()
    const { instruction: configureConfigIx } = await configureConfigInstruction(
      {
        program,
        configAccount: configAccount,
        newPauseAuthority: pauseAuthority.publicKey,
      }
    )
    await provider.sendIx([adminAuthority], configureConfigIx)

    const { instruction } = await cancelSettlementInstruction({
      program,
      settlementAccount,
      rentCollector: rentCollector.publicKey,
      authority: pauseAuthority,
    })

    await provider.sendIx([pauseAuthority], instruction)
    assertNotExist(provider, settlementAccount)

    const rentCollectorInfo = await provider.connection.getAccountInfo(
      rentCollector.publicKey
    )
    assert(rentCollectorInfo !== null)
    expect(rentCollectorInfo.lamports).toEqual(
      LAMPORTS_PER_SOL + rentExemptSettlement
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
        'permitted only to operator or pause authority'
      )
    }
    expect(
      provider.connection.getAccountInfo(settlementAccount)
    ).resolves.not.toBeNull()
  })

  it('cannot close settlement when not expired', async () => {
    const { instruction } = await closeSettlementInstruction({
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
