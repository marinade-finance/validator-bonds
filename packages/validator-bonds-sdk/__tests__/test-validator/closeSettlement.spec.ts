import { Keypair, PublicKey } from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  CLOSE_SETTLEMENT_EVENT,
  closeSettlementInstruction,
  parseCpiEvents,
  assertEvent,
} from '../../src'
import { initTest } from './testValidator'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'
import {
  executeTxSimple,
  waitForNextEpoch,
} from '@marinade.finance/web3js-common'
import { transaction } from '@marinade.finance/web3js-common'
import {
  AnchorExtendedProvider,
  getAnchorValidatorInfo,
} from '@marinade.finance/anchor-common'
import assert from 'assert'

describe('Validator Bonds close settlement', () => {
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

  it('close settlement', async () => {
    const rentCollector = Keypair.generate()
    const { settlementAccount, epoch, maxMerkleNodes, maxTotalClaim } =
      await executeInitSettlement({
        configAccount,
        program,
        provider,
        voteAccount,
        operatorAuthority,
        rentCollector: rentCollector.publicKey,
      })

    const splitRentRefundAccount = Keypair.generate().publicKey
    const tx = await transaction(provider)
    const { instruction } = await closeSettlementInstruction({
      program,
      settlementAccount,
      rentCollector: rentCollector.publicKey,
      splitRentRefundAccount,
    })
    tx.add(instruction)
    await waitForNextEpoch(provider.connection, 15)
    const executionEpoch = (await program.provider.connection.getEpochInfo())
      .epoch
    const executionReturn = await executeTxSimple(provider.connection, tx, [
      provider.wallet,
    ])
    expect(
      provider.connection.getAccountInfo(settlementAccount)
    ).resolves.toBeNull()

    const events = parseCpiEvents(program, executionReturn?.response)
    const e = assertEvent(events, CLOSE_SETTLEMENT_EVENT)
    // Ensure the event was emitted
    assert(e !== undefined)
    expect(e.settlement).toEqual(settlementAccount)
    expect(e.bond).toEqual(bondAccount)
    expect(e.currentEpoch).toEqual(executionEpoch)
    expect(e.expirationEpoch).toEqual(epoch)
    expect(e.lamportsClaimed).toEqual(0)
    expect(e.lamportsFunded).toEqual(0)
    expect(e.merkleNodesClaimed).toEqual(0)
    expect(e.maxMerkleNodes).toEqual(maxMerkleNodes)
    expect(e.maxTotalClaim).toEqual(maxTotalClaim)
    expect(e.splitRentCollector).toEqual(null)
    expect(e.splitRentRefundAccount).toEqual(splitRentRefundAccount)
    expect(e.rentCollector).toEqual(rentCollector.publicKey)
  })
})
