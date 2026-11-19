import assert from 'assert'

import { verifyError } from '@marinade.finance/anchor-common'
import { createUserAndFund, signer } from '@marinade.finance/web3js-1x'
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  PACKET_DATA_SIZE,
  PublicKey,
  SendTransactionError,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import BN from 'bn.js'

import {
  assertNotExist,
  currentEpoch,
  executeVersionedTx,
  initLiteSvmTest,
  warpOffsetEpoch,
  warpOffsetSlot,
  warpToNextEpoch,
} from './litesvm'
import {
  Errors,
  SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE,
  bondsWithdrawerAuthority,
  claimSettlementV2Instruction,
  closeSettlementV2Instruction,
  getSettlementClaims,
  initSettlementInstruction,
  isClaimed,
  mergeStakeInstruction,
  resetStakeInstruction,
  upsizeSettlementClaims,
  withdrawStakeInstruction,
} from '../../src'
import {
  ITEMS_VOTE_ACCOUNT_1,
  MERKLE_ROOT_VOTE_ACCOUNT_1_BUF,
  totalClaimVoteAccount1,
} from '../utils/merkleTreeTestData'
import {
  StakeStates,
  createBondsFundedStakeAccount,
  createInitializedStakeAccount,
  createSettlementFundedDelegatedStake,
  createSettlementFundedInitializedStake,
  createVoteAccount,
  getAndCheckStakeAccount,
} from '../utils/staking'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'

import type { LiteSvmProvider } from './litesvm'
import type { ValidatorBondsProgram } from '../../src'
import type { MerkleTreeNodeWithProof } from '../utils/merkleTreeTestData'
import type { TransactionInstruction } from '@solana/web3.js'

const tenKilobytes = 10 * 1024
const maxMerkleNodesAccountCount =
  10 * 1024 * 1024 * 8 - 8 * SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE
const MAX_UPSIZES_AFTER_INIT = 30
const MAX_UPSIZES_ALONE = 32
const MAX_UPSIZES_BEFORE_CLAIM = 17
const MAX_CLAIMS_PER_LEGACY_TX = 2
const MAX_CLAIMS_PER_V0_TX = 4
const LOOKUP_TABLE_META_SIZE = 56

describe('Validator Bonds instructions batched in one transaction', () => {
  const epochsToClaimSettlement = 1
  let provider: LiteSvmProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let operatorAuthority: Keypair
  let voteAccount: PublicKey

  beforeAll(() => {
    ;({ provider, program } = initLiteSvmTest())
  })

  beforeEach(async () => {
    ;({ configAccount, operatorAuthority } = await executeInitConfigInstruction(
      {
        program,
        provider,
        epochsToClaimSettlement,
      },
    ))
    const { voteAccount: va, validatorIdentity } = await createVoteAccount({
      provider,
    })
    voteAccount = va
    await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
      validatorIdentity,
    })
  })

  function txSize(
    signers: PublicKey[],
    ...ixes: TransactionInstruction[]
  ): number {
    const tx = new Transaction({
      feePayer: provider.walletPubkey,
      blockhash: provider.svm.latestBlockhash(),
      lastValidBlockHeight: 0,
    }).add(...ixes)
    try {
      const message = tx.compileMessage()
      expect(message.header.numRequiredSignatures).toEqual(1 + signers.length)
      return (
        1 +
        64 * message.header.numRequiredSignatures +
        message.serialize().length
      )
    } catch (e) {
      if (e instanceof RangeError) {
        return Number.POSITIVE_INFINITY
      }
      throw e
    }
  }

  async function initSettlement() {
    const { settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: await currentEpoch(provider),
    })
    return settlementAccount
  }

  async function closeIx(settlementAccount: PublicKey) {
    return (await closeSettlementV2Instruction({ program, settlementAccount }))
      .instruction
  }

  async function resetIx(
    settlementAccount: PublicKey,
    stakeAccount: PublicKey,
  ) {
    return (
      await resetStakeInstruction({
        program,
        configAccount,
        stakeAccount,
        voteAccount,
        settlementAccount,
      })
    ).instruction
  }

  async function expectResetToBondsAuthority(stakeAccount: PublicKey) {
    const [bondsAuth] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )
    const [stakeData] = await getAndCheckStakeAccount(
      provider,
      stakeAccount,
      StakeStates.Delegated,
    )
    assert(stakeData.Stake)
    expect(stakeData.Stake.meta.authorized.staker).toEqual(bondsAuth)
    expect(stakeData.Stake.meta.authorized.withdrawer).toEqual(bondsAuth)
  }

  it('close settlement then reset its stake in one tx', async () => {
    const settlementAccount = await initSettlement()
    const stakeAccount = await createSettlementFundedDelegatedStake({
      program,
      provider,
      configAccount,
      settlementAccount,
      voteAccount,
      lamports: 5 * LAMPORTS_PER_SOL,
    })
    await warpOffsetEpoch(provider, epochsToClaimSettlement + 1)
    const close = await closeIx(settlementAccount)
    const reset = await resetIx(settlementAccount, stakeAccount)

    try {
      await provider.sendIx([], reset)
      throw new Error('failure expected; settlement not closed yet')
    } catch (e) {
      verifyError(e, Errors, 6027, 'Settlement has to be closed')
    }

    await provider.sendIx([], close, reset)
    await assertNotExist(provider, settlementAccount)
    await expectResetToBondsAuthority(stakeAccount)
  })

  it('close settlement then withdraw its stake in one tx', async () => {
    const settlementAccount = await initSettlement()
    const stakeAccount = await createSettlementFundedInitializedStake({
      program,
      provider,
      configAccount,
      settlementAccount,
      lamports: LAMPORTS_PER_SOL,
    })
    const user = signer(
      await createUserAndFund({ provider, lamports: LAMPORTS_PER_SOL }),
    )
    await warpOffsetEpoch(provider, epochsToClaimSettlement + 1)
    const close = await closeIx(settlementAccount)
    const { instruction: withdraw } = await withdrawStakeInstruction({
      program,
      configAccount,
      stakeAccount,
      settlementAccount,
      operatorAuthority: operatorAuthority.publicKey,
      withdrawTo: user.publicKey,
    })

    await provider.sendIx([operatorAuthority], close, withdraw)
    await assertNotExist(provider, settlementAccount)
    await assertNotExist(provider, stakeAccount)
    expect(
      (await provider.connection.getAccountInfo(user.publicKey))?.lamports,
    ).toEqual(2 * LAMPORTS_PER_SOL)
  })

  it('close two settlements then reset their stakes in one tx', async () => {
    const settlement1 = await initSettlement()
    const settlement2 = await initSettlement()
    const stake1 = await createSettlementFundedDelegatedStake({
      program,
      provider,
      configAccount,
      settlementAccount: settlement1,
      voteAccount,
      lamports: 5 * LAMPORTS_PER_SOL,
    })
    const stake2 = await createSettlementFundedDelegatedStake({
      program,
      provider,
      configAccount,
      settlementAccount: settlement2,
      voteAccount,
      lamports: 5 * LAMPORTS_PER_SOL,
    })
    await warpOffsetEpoch(provider, epochsToClaimSettlement + 1)
    const ixes = [
      await closeIx(settlement1),
      await closeIx(settlement2),
      await resetIx(settlement1, stake1),
      await resetIx(settlement2, stake2),
    ]
    expect(txSize([], ...ixes)).toBeLessThanOrEqual(PACKET_DATA_SIZE)

    await provider.sendIx([], ...ixes)
    await assertNotExist(provider, settlement1)
    await assertNotExist(provider, settlement2)
    await expectResetToBondsAuthority(stake1)
    await expectResetToBondsAuthority(stake2)
  })

  it('init settlement and upsize claims in one tx up to the instruction trace limit', async () => {
    const { instruction: initIx, settlementClaimsAccount } =
      await initSettlementInstruction({
        program,
        configAccount,
        operatorAuthority,
        voteAccount,
        merkleRoot: Buffer.alloc(32, 7),
        maxMerkleNodes: maxMerkleNodesAccountCount,
        maxTotalClaim: 42,
        epoch: await currentEpoch(provider),
      })
    const { instruction: upsizeIx } = await upsizeSettlementClaims({
      program,
      settlementClaimsAccount,
    })
    const upsizes = (n: number) => Array.from({ length: n }, () => upsizeIx)
    const signers = [operatorAuthority]
    const signerKeys = [operatorAuthority.publicKey]

    expect(
      txSize(signerKeys, initIx, ...upsizes(MAX_UPSIZES_AFTER_INIT + 1)),
    ).toBeLessThanOrEqual(PACKET_DATA_SIZE)
    await expect(
      provider.sendIx(signers, initIx, ...upsizes(MAX_UPSIZES_AFTER_INIT + 1)),
    ).rejects.toThrow(
      `index: ${MAX_UPSIZES_AFTER_INIT + 1}, error: MaxInstructionTraceLengthExceeded`,
    )
    await provider.sendIx(signers, initIx, ...upsizes(MAX_UPSIZES_AFTER_INIT))
    expect(await claimsAccountSize(settlementClaimsAccount)).toEqual(
      (MAX_UPSIZES_AFTER_INIT + 1) * tenKilobytes,
    )

    await expect(
      provider.sendIx([], ...upsizes(MAX_UPSIZES_ALONE + 1)),
    ).rejects.toThrow(
      `index: ${MAX_UPSIZES_ALONE}, error: MaxInstructionTraceLengthExceeded`,
    )
    await provider.sendIx([], ...upsizes(MAX_UPSIZES_ALONE))
    expect(await claimsAccountSize(settlementClaimsAccount)).toEqual(
      (MAX_UPSIZES_AFTER_INIT + 1 + MAX_UPSIZES_ALONE) * tenKilobytes,
    )
  })

  it('init settlement, upsize to full size and claim in one tx', async () => {
    const leaf = leafAt(0)
    const {
      instruction: initIxProbe,
      settlementAccount,
      settlementClaimsAccount,
    } = await initSettlementInstruction({
      program,
      configAccount,
      operatorAuthority,
      voteAccount,
      merkleRoot: MERKLE_ROOT_VOTE_ACCOUNT_1_BUF,
      maxMerkleNodes: 1,
      maxTotalClaim: totalClaimVoteAccount1,
      epoch: await currentEpoch(provider),
    })
    const stakeAccountFrom = await createSettlementFundedInitializedStake({
      program,
      provider,
      configAccount,
      settlementAccount,
      lamports: 10 * LAMPORTS_PER_SOL,
    })
    const { stakeAccount: stakeAccountTo } =
      await createInitializedStakeAccount({
        provider,
        rentExempt: 2 * LAMPORTS_PER_SOL,
        staker: leaf.treeNode.stakeAuthority,
        withdrawer: leaf.treeNode.withdrawAuthority,
      })
    const { instruction: upsizeIx } = await upsizeSettlementClaims({
      program,
      settlementClaimsAccount,
    })
    const claimIx = await claimIxFor(
      leaf,
      settlementAccount,
      stakeAccountFrom,
      stakeAccountTo,
      MERKLE_ROOT_VOTE_ACCOUNT_1_BUF,
    )
    const signers = [operatorAuthority.publicKey]
    let maxUpsizes = 0
    while (
      txSize(
        signers,
        initIxProbe,
        ...Array.from({ length: maxUpsizes + 1 }, () => upsizeIx),
        claimIx,
      ) <= PACKET_DATA_SIZE
    ) {
      maxUpsizes++
    }
    expect(maxUpsizes).toEqual(MAX_UPSIZES_BEFORE_CLAIM)

    const maxMerkleNodes =
      (maxUpsizes + 1) * tenKilobytes * 8 -
      8 * SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE
    const { instruction: initIx, settlementAccount: settlementSized } =
      await initSettlementInstruction({
        program,
        configAccount,
        operatorAuthority,
        voteAccount,
        merkleRoot: MERKLE_ROOT_VOTE_ACCOUNT_1_BUF,
        maxMerkleNodes,
        maxTotalClaim: totalClaimVoteAccount1,
        epoch: await currentEpoch(provider),
      })
    expect(settlementSized).toEqual(settlementAccount)

    await provider.sendIx(
      [operatorAuthority],
      initIx,
      ...Array.from({ length: maxUpsizes }, () => upsizeIx),
      claimIx,
    )
    const settlementClaims = await getSettlementClaims(
      program,
      settlementClaimsAccount,
    )
    expect(settlementClaims.bitmap.maxRecords).toEqual(maxMerkleNodes)
    expect(settlementClaims.bitmap.bitSet.counter).toEqual(1)
    expect(
      (await provider.connection.getAccountInfo(settlementClaimsAccount))?.data
        .length,
    ).toEqual((maxUpsizes + 1) * tenKilobytes)
    expect(
      (await provider.connection.getAccountInfo(stakeAccountTo))?.lamports,
    ).toEqual(2 * LAMPORTS_PER_SOL + leaf.treeNode.claim.toNumber())
  })

  it('merge distinct sources into one destination in one tx', async () => {
    const [destination, source1, source2] = await bondsFundedActiveStakes()
    const ixes = [
      await mergeIx(source1, destination),
      await mergeIx(source2, destination),
    ]
    await provider.sendIx([], ...ixes)
    await assertNotExist(provider, source1)
    await assertNotExist(provider, source2)
    expect(
      (await provider.connection.getAccountInfo(destination))?.lamports,
    ).toEqual(3 * 3 * LAMPORTS_PER_SOL)
  })

  it('cannot merge one source twice in one tx', async () => {
    const [destination1, destination2, source] = await bondsFundedActiveStakes()
    const ixes = [
      await mergeIx(source, destination1),
      await mergeIx(source, destination2),
    ]
    // the mainnet core-BPF stake program leaves the merged source undecodable as a stake
    // account, so the second merge fails on loading it (bankrun's native one reached 6024)
    const error: unknown = await provider.sendIx([], ...ixes).then(
      () => undefined,
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(SendTransactionError)
    expect((error as SendTransactionError).message).toContain(
      'index: 1, error: BorshIoError',
    )
    expect((error as SendTransactionError).logs).toContain(
      'Program log: ProgramError caused by account: source_stake. Error Code: BorshIoError. Error Number: 64424509440. Error Message: IO Error.',
    )
    for (const stake of [destination1, destination2, source]) {
      expect(
        (await provider.connection.getAccountInfo(stake))?.lamports,
      ).toEqual(3 * LAMPORTS_PER_SOL)
    }
  })

  it('claim several leaves of one settlement in one tx', async () => {
    const { settlementAccount, stakeAccountFrom } = await claimableSettlement()
    const claims: {
      leaf: MerkleTreeNodeWithProof
      to: PublicKey
      ix: TransactionInstruction
    }[] = []
    for (const leaf of ITEMS_VOTE_ACCOUNT_1) {
      const to = await destinationFor(leaf)
      claims.push({
        leaf,
        to,
        ix: await claimIxFor(leaf, settlementAccount, stakeAccountFrom, to),
      })
    }
    const ixes = claims.map(c => c.ix)
    const lookupTable = await injectLookupTable(ixes)
    const maxFitting = (size: (n: number) => number) => {
      let n = 0
      while (n < ixes.length && size(n + 1) <= PACKET_DATA_SIZE) {
        n++
      }
      return n
    }
    const maxLegacy = maxFitting(n => txSize([], ...ixes.slice(0, n)))
    const maxV0 = maxFitting(n => v0TxSize(lookupTable, ixes.slice(0, n)))
    expect(maxLegacy).toEqual(MAX_CLAIMS_PER_LEGACY_TX)
    expect(maxV0).toEqual(MAX_CLAIMS_PER_V0_TX)

    executeVersionedTx(provider, await v0Tx(lookupTable, ixes.slice(0, maxV0)))
    for (const [i, { leaf, to }] of claims.entries()) {
      expect(
        await isClaimed(program, settlementAccount, leaf.treeNode.index),
      ).toBe(i < maxV0)
      expect((await provider.connection.getAccountInfo(to))?.lamports).toEqual(
        2 * LAMPORTS_PER_SOL + (i < maxV0 ? leaf.treeNode.claim.toNumber() : 0),
      )
    }
  })

  it('claim batch with an already claimed leaf fails as a whole', async () => {
    const { settlementAccount, stakeAccountFrom } = await claimableSettlement()
    const [fresh1, claimed, fresh2] = [leafAt(0), leafAt(1), leafAt(2)]
    const claims = []
    for (const leaf of [fresh1, fresh2, claimed]) {
      const to = await destinationFor(leaf)
      claims.push({
        leaf,
        to,
        ix: await claimIxFor(leaf, settlementAccount, stakeAccountFrom, to),
      })
    }
    const [fresh1Claim, fresh2Claim, claimedClaim] = claims
    assert(fresh1Claim && fresh2Claim && claimedClaim)
    await provider.sendIx([], claimedClaim.ix)
    expect(
      await isClaimed(program, settlementAccount, claimed.treeNode.index),
    ).toBe(true)

    const ixes = [fresh1Claim.ix, claimedClaim.ix, fresh2Claim.ix]
    const lookupTable = await injectLookupTable(ixes)
    try {
      executeVersionedTx(provider, await v0Tx(lookupTable, ixes))
      throw new Error('failure expected; one leaf already claimed')
    } catch (e) {
      verifyError(e, Errors, 6070, 'has been already claimed')
    }
    for (const { leaf, to } of [fresh1Claim, fresh2Claim]) {
      expect(
        await isClaimed(program, settlementAccount, leaf.treeNode.index),
      ).toBe(false)
      expect((await provider.connection.getAccountInfo(to))?.lamports).toEqual(
        2 * LAMPORTS_PER_SOL,
      )
    }

    executeVersionedTx(
      provider,
      await v0Tx(lookupTable, [fresh1Claim.ix, fresh2Claim.ix]),
    )
    for (const { leaf } of claims) {
      expect(
        await isClaimed(program, settlementAccount, leaf.treeNode.index),
      ).toBe(true)
    }
  })

  async function injectLookupTable(
    ixes: TransactionInstruction[],
  ): Promise<AddressLookupTableAccount> {
    const addresses = [
      ...new Set(ixes.flatMap(ix => ix.keys.map(k => k.pubkey.toBase58()))),
    ].map(a => new PublicKey(a))
    const header = Buffer.alloc(LOOKUP_TABLE_META_SIZE)
    header.writeUInt32LE(1, 0)
    header.writeBigUInt64LE(BigInt('0xffffffffffffffff'), 4)
    const data = Buffer.concat([header, ...addresses.map(a => a.toBuffer())])
    const key = Keypair.generate().publicKey
    provider.setAccount(key, {
      lamports: LAMPORTS_PER_SOL,
      data,
      owner: AddressLookupTableProgram.programId,
      executable: false,
    })
    await warpOffsetSlot(provider, 1)
    return new AddressLookupTableAccount({
      key,
      state: AddressLookupTableAccount.deserialize(data),
    })
  }

  function v0Message(
    lookupTable: AddressLookupTableAccount,
    ixes: TransactionInstruction[],
  ) {
    return new TransactionMessage({
      payerKey: provider.walletPubkey,
      recentBlockhash: provider.svm.latestBlockhash(),
      instructions: ixes,
    }).compileToV0Message([lookupTable])
  }

  function v0TxSize(
    lookupTable: AddressLookupTableAccount,
    ixes: TransactionInstruction[],
  ): number {
    try {
      const message = v0Message(lookupTable, ixes)
      expect(message.header.numRequiredSignatures).toEqual(1)
      return 1 + 64 + message.serialize().length
    } catch (e) {
      if (e instanceof RangeError) {
        return Number.POSITIVE_INFINITY
      }
      throw e
    }
  }

  async function v0Tx(
    lookupTable: AddressLookupTableAccount,
    ixes: TransactionInstruction[],
  ): Promise<VersionedTransaction> {
    return await provider.wallet.signTransaction(
      new VersionedTransaction(v0Message(lookupTable, ixes)),
    )
  }

  async function claimsAccountSize(settlementClaimsAccount: PublicKey) {
    return (await provider.connection.getAccountInfo(settlementClaimsAccount))
      ?.data.length
  }

  function leafAt(index: number): MerkleTreeNodeWithProof {
    const leaf = ITEMS_VOTE_ACCOUNT_1[index]
    assert(leaf !== undefined)
    return leaf
  }

  async function claimableSettlement() {
    const { settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: await currentEpoch(provider),
      merkleRoot: MERKLE_ROOT_VOTE_ACCOUNT_1_BUF,
      maxMerkleNodes: ITEMS_VOTE_ACCOUNT_1.length,
      maxTotalClaim: totalClaimVoteAccount1,
    })
    const stakeAccountFrom = await createSettlementFundedInitializedStake({
      program,
      provider,
      configAccount,
      settlementAccount,
      lamports: 10 * LAMPORTS_PER_SOL,
    })
    return { settlementAccount, stakeAccountFrom }
  }

  async function destinationFor(
    leaf: MerkleTreeNodeWithProof,
  ): Promise<PublicKey> {
    const { stakeAccount } = await createInitializedStakeAccount({
      provider,
      rentExempt: 2 * LAMPORTS_PER_SOL,
      staker: leaf.treeNode.stakeAuthority,
      withdrawer: leaf.treeNode.withdrawAuthority,
    })
    return stakeAccount
  }

  async function claimIxFor(
    leaf: MerkleTreeNodeWithProof,
    settlementAccount: PublicKey,
    stakeAccountFrom: PublicKey,
    stakeAccountTo: PublicKey,
    settlementMerkleRoot?: Buffer | Uint8Array,
  ): Promise<TransactionInstruction> {
    const { instruction, settlementAccount: settlement } =
      await claimSettlementV2Instruction({
        program,
        claimAmount: leaf.treeNode.claim,
        index: leaf.treeNode.index,
        merkleProof: leaf.proof,
        stakeAccountFrom,
        stakeAccountTo,
        stakeAccountStaker: leaf.treeNode.stakeAuthority,
        stakeAccountWithdrawer: leaf.treeNode.withdrawAuthority,
        ...(settlementMerkleRoot === undefined
          ? { settlementAccount }
          : {
              settlementMerkleRoot,
              settlementEpoch: new BN(
                (await currentEpoch(provider)).toString(),
              ),
              configAccount,
              voteAccount,
            }),
      })
    expect(settlement).toEqual(settlementAccount)
    return instruction
  }

  async function bondsFundedActiveStakes(): Promise<
    [PublicKey, PublicKey, PublicKey]
  > {
    const create = () =>
      createBondsFundedStakeAccount({
        program,
        provider,
        configAccount,
        voteAccount,
        lamports: 3 * LAMPORTS_PER_SOL,
      })
    const stakes: [PublicKey, PublicKey, PublicKey] = [
      await create(),
      await create(),
      await create(),
    ]
    await warpToNextEpoch(provider)
    return stakes
  }

  async function mergeIx(source: PublicKey, destination: PublicKey) {
    return (
      await mergeStakeInstruction({
        program,
        configAccount,
        sourceStakeAccount: source,
        destinationStakeAccount: destination,
      })
    ).instruction
  }
})
