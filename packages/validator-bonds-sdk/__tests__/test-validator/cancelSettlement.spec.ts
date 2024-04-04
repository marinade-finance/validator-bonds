import { Keypair, PublicKey } from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  parseCpiEvents,
  assertEvent,
  cancelSettlementInstruction,
  CANCEL_SETTLEMENT_EVENT,
} from '../../src'
import { initTest } from './testValidator'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'
import { executeTxSimple } from '@marinade.finance/web3js-common'
import { transaction } from '@marinade.finance/web3js-common'
import {
  AnchorExtendedProvider,
  getAnchorValidatorInfo,
} from '@marinade.finance/anchor-common'
import assert from 'assert'

describe('Validator Bonds cancel settlement', () => {
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
      }
    ))
    ;({ voteAccount, bondAccount } = await executeInitBondInstruction({
      configAccount,
      program,
      provider,
      validatorIdentity,
    }))
  })

  it('cancel settlement', async () => {
    const { settlementAccount, rentCollector, maxMerkleNodes, maxTotalClaim } =
      await executeInitSettlement({
        configAccount,
        program,
        provider,
        voteAccount,
        operatorAuthority,
      })

    const tx = await transaction(provider)
    const { instruction } = await cancelSettlementInstruction({
      program,
      settlementAccount,
      authority: operatorAuthority,
    })
    tx.add(instruction)
    const executionReturn = await executeTxSimple(provider.connection, tx, [
      provider.wallet,
      operatorAuthority,
    ])
    expect(
      provider.connection.getAccountInfo(settlementAccount)
    ).resolves.toBeNull()

    const events = parseCpiEvents(program, executionReturn?.response)
    const e = assertEvent(events, CANCEL_SETTLEMENT_EVENT)
    // Ensure the event was emitted
    assert(e !== undefined)
    expect(e.settlement).toEqual(settlementAccount)
    expect(e.bond).toEqual(bondAccount)
    expect(e.lamportsClaimed).toEqual(0)
    expect(e.lamportsFunded).toEqual(0)
    expect(e.merkleNodesClaimed).toEqual(0)
    expect(e.maxMerkleNodes).toEqual(maxMerkleNodes)
    expect(e.maxTotalClaim).toEqual(maxTotalClaim)
    expect(e.splitRentCollector).toEqual(null)
    expect(e.splitRentRefund).toEqual(null)
    expect(e.rentCollector).toEqual(rentCollector)
    expect(e.authority).toEqual(operatorAuthority.publicKey)
  })
})
