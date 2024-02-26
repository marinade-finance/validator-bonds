import { Keypair, PublicKey } from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  CLOSE_SETTLEMENT_EVENT,
  closeSettlementInstruction,
  CloseSettlementEvent,
} from '../../src'
import { getValidatorInfo, initTest, waitForNextEpoch } from './testValidator'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'
import { ExtendedProvider } from '../utils/provider'
import { transaction } from '@marinade.finance/web3js-common'

describe('Validator Bonds close settlement', () => {
  let provider: ExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let operatorAuthority: Keypair
  let validatorIdentity: Keypair
  let voteAccount: PublicKey
  let bondAccount: PublicKey

  beforeAll(async () => {
    ;({ provider, program } = await initTest())
    ;({ validatorIdentity } = await getValidatorInfo(provider.connection))
  })

  afterAll(async () => {
    // workaround: "Jest has detected the following 1 open handle", see `initConfig.spec.ts`
    await new Promise(resolve => setTimeout(resolve, 500))
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

    const event = new Promise<CloseSettlementEvent>(resolve => {
      const listener = program.addEventListener(
        CLOSE_SETTLEMENT_EVENT,
        async event => {
          await program.removeEventListener(listener)
          resolve(event)
        }
      )
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
    await provider.sendIx([], instruction)
    expect(
      provider.connection.getAccountInfo(settlementAccount)
    ).resolves.toBeNull()

    await event.then(e => {
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
})
