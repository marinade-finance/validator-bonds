import { Keypair, PublicKey, Signer } from '@solana/web3.js'
import {
  INIT_SETTLEMENT_EVENT,
  InitSettlementEvent,
  ValidatorBondsProgram,
  findSettlements,
  getSettlement,
  initSettlementInstruction,
  settlementAddress,
  settlementStakerAuthority,
} from '../../src'
import { getValidatorInfo, initTest } from './testValidator'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'
import { ExtendedProvider } from '../utils/provider'
import {
  transaction,
  Wallet,
  splitAndExecuteTx,
} from '@marinade.finance/web3js-common'
import { AnchorProvider } from '@coral-xyz/anchor'

describe('Validator Bonds init settlement', () => {
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
      }
    ))
    ;({ voteAccount, bondAccount } = await executeInitBondInstruction({
      configAccount,
      program,
      provider,
      validatorIdentity,
    }))
  })

  it('init settlement', async () => {
    const event = new Promise<InitSettlementEvent>(resolve => {
      const listener = program.addEventListener(
        INIT_SETTLEMENT_EVENT,
        async event => {
          await program.removeEventListener(listener)
          resolve(event)
        }
      )
    })

    const currentEpoch = (await program.provider.connection.getEpochInfo())
      .epoch
    const merkleRoot = Buffer.alloc(32)
    const { settlementAccount, rentCollector } = await executeInitSettlement({
      program,
      provider,
      configAccount,
      operatorAuthority,
      voteAccount,
      currentEpoch,
      merkleRoot,
      maxMerkleNodes: 2,
      maxTotalClaim: 100,
    })

    const settlementData = await getSettlement(program, settlementAccount)

    const [, bump] = settlementAddress(
      bondAccount,
      merkleRoot,
      currentEpoch,
      program.programId
    )
    const [settlementAuth, authorityBump] = settlementStakerAuthority(
      settlementAccount,
      program.programId
    )

    expect(settlementData.bond).toEqual(bondAccount)
    expect(settlementData.bumps).toEqual({
      pda: bump,
      authority: authorityBump,
    })
    expect(settlementData.epochCreatedFor).toEqual(currentEpoch)
    expect(settlementData.maxMerkleNodes).toEqual(2)
    expect(settlementData.maxTotalClaim).toEqual(100)
    expect(settlementData.merkleRoot).toEqual(Array.from(merkleRoot))
    expect(settlementData.rentCollector).toEqual(rentCollector)
    expect(settlementData.authority).toEqual(settlementAuth)
    expect(settlementData.lamportsFunded).toEqual(0)
    expect(settlementData.lamportsClaimed).toEqual(0)
    expect(settlementData.merkleNodesClaimed).toEqual(0)
    expect(settlementData.splitRentAmount).toEqual(0)
    expect(settlementData.splitRentCollector).toEqual(null)

    await event.then(e => {
      expect(e.bond).toEqual(bondAccount)
      expect(e.voteAccount).toEqual(voteAccount)
      expect(e.bumps).toEqual({ pda: bump, authority: authorityBump })
      expect(e.epochCreatedFor).toEqual(currentEpoch)
      expect(e.maxMerkleNodes).toEqual(2)
      expect(e.maxTotalClaim).toEqual(100)
      expect(e.merkleRoot).toEqual(Array.from(merkleRoot))
      expect(e.rentCollector).toEqual(rentCollector)
      expect(e.authority).toEqual(settlementAuth)
    })
  })

  it('find settlement', async () => {
    const tx = await transaction(provider)
    const signers: (Signer | Wallet)[] = [
      (provider as unknown as AnchorProvider).wallet,
      operatorAuthority,
    ]

    const numberOfSettlements = 19

    const currentEpoch = (await program.provider.connection.getEpochInfo())
      .epoch
    const buffers: Buffer[] = []
    for (let i = 1; i <= numberOfSettlements; i++) {
      const buffer = Buffer.from(
        Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))
      )
      buffers.push(buffer)
      const { instruction } = await initSettlementInstruction({
        program,
        bondAccount,
        operatorAuthority,
        configAccount,
        merkleRoot: buffer,
        epoch: currentEpoch,
        voteAccount,
        maxTotalClaim: 1,
        maxMerkleNodes: 11,
      })
      tx.add(instruction)
    }
    expect(tx.instructions.length).toEqual(numberOfSettlements)

    await splitAndExecuteTx({
      connection: provider.connection,
      transaction: tx,
      signers,
      errMessage: 'Failed to init bonds and withdraw requests',
    })

    let settlementList = await findSettlements({
      program,
      epoch: currentEpoch,
    })
    expect(settlementList.length).toBeGreaterThanOrEqual(numberOfSettlements)

    settlementList = await findSettlements({
      program,
      bond: bondAccount,
    })
    expect(settlementList.length).toEqual(numberOfSettlements)

    settlementList = await findSettlements({
      program,
      bond: bondAccount,
      epoch: currentEpoch,
    })
    expect(settlementList.length).toEqual(numberOfSettlements)

    settlementList = await findSettlements({ program })
    expect(settlementList.length).toBeGreaterThanOrEqual(numberOfSettlements)

    for (let i = 0; i < numberOfSettlements; i++) {
      settlementList = await findSettlements({
        program,
        merkleRoot: buffers[i],
      })
      expect(settlementList.length).toEqual(1)
      settlementList = await findSettlements({
        program,
        bond: bondAccount,
        epoch: currentEpoch,
        merkleRoot: buffers[i],
      })
      expect(settlementList.length).toEqual(1)
    }
  })
})
