import {
  Bond,
  Errors,
  SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE,
  ValidatorBondsProgram,
  getBond,
  getSettlement,
  getSettlementClaims,
  getSettlementClaimsBySettlement,
  initSettlementInstruction,
  settlementAddress,
  settlementClaimsAddress,
  settlementStakerAuthority,
  upsizeSettlementClaims,
} from '../../src'
import {
  BankrunExtendedProvider,
  assertNotExist,
  currentEpoch,
} from '@marinade.finance/bankrun-utils'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
} from '../utils/testTransactions'
import { ProgramAccount } from '@coral-xyz/anchor'
import { Keypair, PublicKey } from '@solana/web3.js'
import { createVoteAccount } from '../utils/staking'
import { verifyError } from '@marinade.finance/anchor-common'
import { initBankrunTest } from './bankrun'
import { isInitialized } from '../../src/settlementClaims'

// maximum increase in account size per instruction
//   see https://github.com/anza-xyz/agave/blob/v2.0.1/sdk/program/src/entrypoint.rs#L263
const tenKilobytes = 10 * 1024

// We calculate how many bitmap records can fit in 10MB account when working with SettlementClaims account
// ----
// SettlementClaims account consists of 56 bytes header and then follows bytes of the bitmap
// 10 MB is maximum account size for Solana account (see https://github.com/anza-xyz/agave/blob/v2.0.1/sdk/program/src/system_instruction.rs#L85)
// 8 bits per byte; 10 MB means 10 * 1024 * 1024 bytes
// SettlementClaims account header size is 56 bytes, that size would fit 56 * 8 records when used as bitmap storage
// In summary we can fit (10 * 1024 * 1024) bytes * 8 bits - 56 bytes * 8 bits of records to SettlementClaims account
const maxMerkleNodesAccountCount =
  10 * 1024 * 1024 * 8 - 8 * SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE

describe('Validator Bonds init settlement', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let bond: ProgramAccount<Bond>
  let operatorAuthority: Keypair
  let validatorIdentity: Keypair
  let voteAccount: PublicKey

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
  })

  beforeEach(async () => {
    ;({ configAccount, operatorAuthority } = await executeInitConfigInstruction(
      {
        program,
        provider,
      }
    ))
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
    bond = {
      publicKey: bondAccount,
      account: await getBond(program, bondAccount),
    }
  })

  it('init settlement', async () => {
    const merkleRoot = Buffer.from(
      Array.from({ length: 32 }, () => Math.floor(Math.random() * 256))
    )
    const epochNow = await currentEpoch(provider)
    const rentCollector = Keypair.generate().publicKey
    const { instruction, settlementAccount, epoch } =
      await initSettlementInstruction({
        program,
        bondAccount: bond.publicKey,
        operatorAuthority,
        merkleRoot,
        maxMerkleNodes: 1,
        maxTotalClaim: 3,
        voteAccount,
        epoch: epochNow,
        configAccount,
        rentCollector,
      })
    await provider.sendIx([operatorAuthority], instruction)

    expect(epoch.toString()).toEqual(epochNow.toString())

    const [settlementAddr, bump] = settlementAddress(
      bond.publicKey,
      merkleRoot,
      epoch,
      program.programId
    )
    expect(settlementAddr).toEqual(settlementAccount)
    const [authorityAddr, authorityBump] = settlementStakerAuthority(
      settlementAccount,
      program.programId
    )

    const settlementData = await getSettlement(program, settlementAccount)
    expect(settlementData.bond).toEqual(bond.publicKey)
    expect(settlementData.bumps.pda).toEqual(bump)
    expect(settlementData.bumps.stakerAuthority).toEqual(authorityBump)
    expect(settlementData.stakerAuthority).toEqual(authorityAddr)
    expect(settlementData.epochCreatedFor).toEqual(epoch)
    expect(settlementData.maxMerkleNodes).toEqual(1)
    expect(settlementData.maxTotalClaim).toEqual(3)
    expect(settlementData.merkleRoot).toEqual(Array.from(merkleRoot))
    expect(settlementData.merkleNodesClaimed).toEqual(0)
    expect(settlementData.lamportsFunded).toEqual(0)
    expect(settlementData.lamportsClaimed).toEqual(0)
    expect(settlementData.rentCollector).toEqual(rentCollector)
    expect(settlementData.splitRentAmount).toEqual(0)
    expect(settlementData.splitRentCollector).toEqual(null)

    const settlementAccountInfo =
      await provider.connection.getAccountInfo(settlementAccount)
    console.log(
      'settlement account length',
      settlementAccountInfo?.data.byteLength
    )
    // not account change size expected
    expect(settlementAccountInfo?.data.byteLength).toEqual(328)

    const [settlementClaimsAddr] = settlementClaimsAddress(
      settlementAccount,
      program.programId
    )
    const settlementClaimsAccountInfo =
      await provider.connection.getAccountInfo(settlementClaimsAddr)
    expect(settlementClaimsAccountInfo).not.toBeNull()
    // the size for bitmap is calculated to be at least 8 bytes
    // 56 bytes is size for account header then 1 byte for bitmap
    expect(settlementClaimsAccountInfo?.data.byteLength).toEqual(
      SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE + 1
    )

    const settlementClaims = await getSettlementClaimsBySettlement(
      program,
      settlementAccount
    )
    expect(settlementClaims.bitmap.bitmapData.length).toEqual(1)
    expect(settlementClaims.bitmap.bitSet.asString.length).toEqual(1)
    expect(settlementClaims.bitmap.bitSet.counter).toEqual(0)
  })

  it('cannot init settlement with wrong buffer size', async () => {
    const merkleRoot = Buffer.from(
      Array.from({ length: 30 }, () => Math.floor(Math.random() * 256))
    )
    const { instruction, settlementAccount } = await initSettlementInstruction({
      program,
      bondAccount: bond.publicKey,
      merkleRoot,
      maxMerkleNodes: 1,
      maxTotalClaim: 3,
      voteAccount,
      configAccount,
      epoch: await currentEpoch(provider),
    })
    try {
      await provider.sendIx([operatorAuthority], instruction)
      throw new Error('failure; expected wrong seeds constraint')
    } catch (e) {
      // Error Code: ConstraintSeeds. Error Number: 2006. Error Message: A seeds constraint was violated.
      if (!(e as Error).message.includes('custom program error: 0x7d6')) {
        throw e
      }
    }
    assertNotExist(provider, settlementAccount)
  })

  it('init settlement with future epoch', async () => {
    const merkleRoot = Buffer.alloc(32)
    const futureEpoch = (await currentEpoch(provider)) + 2024
    const { instruction, settlementAccount } = await initSettlementInstruction({
      program,
      bondAccount: bond.publicKey,
      operatorAuthority,
      merkleRoot,
      maxMerkleNodes: 1,
      maxTotalClaim: 3,
      voteAccount,
      configAccount,
      epoch: futureEpoch,
    })
    await provider.sendIx([operatorAuthority], instruction)
    expect(
      await provider.connection.getAccountInfo(settlementAccount)
    ).not.toBeNull()
  })

  it('cannot init settlement with wrong authority', async () => {
    const merkleRoot = Buffer.alloc(32)
    const wrongOperator = Keypair.generate()
    const { instruction, settlementAccount } = await initSettlementInstruction({
      program,
      bondAccount: bond.publicKey,
      operatorAuthority: wrongOperator,
      merkleRoot,
      maxMerkleNodes: 1,
      maxTotalClaim: 3,
      voteAccount,
      epoch: await currentEpoch(provider),
      configAccount,
    })
    try {
      await provider.sendIx([wrongOperator], instruction)
      throw new Error('failure; expected wrong operator authority')
    } catch (e) {
      verifyError(e, Errors, 6003, 'operator authority signature')
    }
    assertNotExist(provider, settlementAccount)
  })

  it('cannot init settlement with too many records', async () => {
    const merkleRoot = Buffer.alloc(32)
    const { instruction: ixFail, settlementAccount: failureAccount } =
      await initSettlementInstruction({
        program,
        bondAccount: bond.publicKey,
        operatorAuthority,
        merkleRoot,
        maxMerkleNodes: maxMerkleNodesAccountCount + 1,
        maxTotalClaim: 111,
        voteAccount,
        epoch: await currentEpoch(provider),
        configAccount,
      })
    try {
      await provider.sendIx([operatorAuthority], ixFail)
      throw new Error('failure; too big to fit in account')
    } catch (e) {
      verifyError(e, Errors, 6068, 'exceed maximum to fit Solana')
    }
    assertNotExist(provider, failureAccount)
  })

  it('init settlement not-fully initialized', async () => {
    const merkleRoot = Buffer.alloc(32)
    const {
      instruction: ix1,
      settlementAccount: settlementMaxSizeAccount,
      settlementClaimsAccount,
    } = await initSettlementInstruction({
      program,
      bondAccount: bond.publicKey,
      operatorAuthority,
      merkleRoot,
      maxMerkleNodes: maxMerkleNodesAccountCount,
      maxTotalClaim: 42,
      voteAccount,
      epoch: await currentEpoch(provider),
      configAccount,
    })
    await provider.sendIx([operatorAuthority], ix1)
    expect(
      await provider.connection.getAccountInfo(settlementMaxSizeAccount)
    ).not.toBeNull()
    const settlementClaimsAccountInfo1 =
      await provider.connection.getAccountInfo(settlementClaimsAccount)
    expect(settlementClaimsAccountInfo1).not.toBeNull()
    expect(isInitialized(program, settlementClaimsAccountInfo1!)).toBe(false)
    expect(settlementClaimsAccountInfo1?.data.length).toEqual(tenKilobytes)

    const { instruction: upsizeIx } = await upsizeSettlementClaims({
      program,
      settlementClaimsAccount,
    })
    await provider.sendIx([], upsizeIx)
    const settlementClaimsAccountInfo2 =
      await provider.connection.getAccountInfo(settlementClaimsAccount)
    expect(settlementClaimsAccountInfo2).not.toBeNull()
    expect(settlementClaimsAccountInfo2?.data.length).toEqual(
      settlementClaimsAccountInfo1!.data.length + tenKilobytes
    )
    expect(settlementClaimsAccountInfo2?.data.length).toEqual(2 * tenKilobytes)
    expect(isInitialized(program, settlementClaimsAccountInfo2!)).toBe(false)

    try {
      await getSettlementClaimsBySettlement(program, settlementMaxSizeAccount)
    } catch (e) {
      if (!(e as Error).message.includes('not fully initialized')) {
        throw e
      }
    }

    // generator of array of 10 items
    const upsizeIxes = Array.from({ length: 10 }, () => upsizeIx)
    await provider.sendIx([], ...upsizeIxes)
    const settlementClaimsAccountInfo12 =
      await provider.connection.getAccountInfo(settlementClaimsAccount)
    expect(settlementClaimsAccountInfo12).not.toBeNull()
    expect(settlementClaimsAccountInfo12?.data.length).toEqual(
      12 * tenKilobytes
    )
    expect(isInitialized(program, settlementClaimsAccountInfo12!)).toBe(false)
  })

  it('init settlement with one upsize', async () => {
    const merkleRoot = Buffer.alloc(32)
    const { instruction, settlementClaimsAccount } =
      await initSettlementInstruction({
        program,
        bondAccount: bond.publicKey,
        operatorAuthority,
        merkleRoot,
        maxMerkleNodes: tenKilobytes * 8,
        maxTotalClaim: 222,
        voteAccount,
        epoch: await currentEpoch(provider),
        configAccount,
      })
    const { instruction: upsizeIx } = await upsizeSettlementClaims({
      program,
      settlementClaimsAccount,
    })
    await provider.sendIx([operatorAuthority], instruction, upsizeIx)

    const settlementClaimsAccountInfo =
      await provider.connection.getAccountInfo(settlementClaimsAccount)
    expect(settlementClaimsAccountInfo).not.toBeNull()
    expect(settlementClaimsAccountInfo?.data.length).toEqual(
      tenKilobytes + SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE
    )
    expect(isInitialized(program, settlementClaimsAccountInfo!)).toBe(true)
    const settlementClaimsData = await getSettlementClaims(
      program,
      settlementClaimsAccount
    )
    // the bitSet as string returns 8 chars(0s,1s) with comma (+1) where comma misses at the end
    expect(settlementClaimsData.bitmap.bitSet.asString.length).toEqual(
      (8 + 1) * tenKilobytes - 1
    )
    expect(settlementClaimsData.bitmap.bitSet.counter).toEqual(0)
    expect(settlementClaimsData.bitmap.maxRecords).toEqual(8 * tenKilobytes)
  })
})
