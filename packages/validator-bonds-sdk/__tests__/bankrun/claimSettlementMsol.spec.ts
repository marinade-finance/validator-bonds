import { verifyError } from '@marinade.finance/anchor-common'
import {
  bankrunExecuteIx,
  currentEpoch,
  warpToNextEpoch,
} from '@marinade.finance/bankrun-utils'
import { Keypair, LAMPORTS_PER_SOL, SystemProgram } from '@solana/web3.js'

import { initBankrunTest, warpOffsetSlot } from './bankrun'
import {
  Errors,
  MARINADE_LIQUID_STATE,
  claimSettlementV2Instruction,
  isClaimed,
} from '../../src'
import {
  MARINADE_LIQUID_STAKE_LIST,
  buildMarinadeLiquidStakeList,
  buildMarinadeLiquidState,
  injectMarinadeLiquidAccounts,
  injectValidMarinadeLiquidAccounts,
} from '../utils/marinadeLiquid'
import {
  ITEMS_MSOL,
  MERKLE_ROOT_MSOL_BUF,
  configAccountKeypair,
  totalClaimMsol,
} from '../utils/merkleTreeTestData'
import {
  createInitializedStakeAccount,
  createSettlementFundedInitializedStake,
  createVoteAccount,
} from '../utils/staking'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '../utils/testTransactions'

import type { ValidatorBondsProgram } from '../../src'
import type { MerkleTreeNodeWithProof } from '../utils/merkleTreeTestData'
import type { BankrunExtendedProvider } from '@marinade.finance/bankrun-utils'
import type { PublicKey } from '@solana/web3.js'

const STAKE_LIST_CAPACITY = 10000
const MAINNET_STAKE_LIST_COUNT = 487

function leafAt(index: number): MerkleTreeNodeWithProof {
  const leaf = ITEMS_MSOL[index]
  if (leaf === undefined) {
    throw new Error(`mSOL merkle tree has no leaf at index ${index}`)
  }
  return leaf
}

describe('Validator Bonds claim settlement of the mSOL withdrawer', () => {
  let provider: BankrunExtendedProvider
  let program: ValidatorBondsProgram
  let settlementAccount: PublicKey
  let stakeAccountFrom: PublicKey

  beforeAll(async () => {
    ;({ provider, program } = await initBankrunTest())
    const { configAccount, operatorAuthority } =
      await executeInitConfigInstruction({
        program,
        provider,
        epochsToClaimSettlement: 3,
        configAccountKeypair,
      })
    const { voteAccount, validatorIdentity } = await createVoteAccount({
      provider,
    })
    await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
      validatorIdentity,
    })
    await warpToNextEpoch(provider)
    ;({ settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      currentEpoch: await currentEpoch(provider),
      merkleRoot: MERKLE_ROOT_MSOL_BUF,
      maxMerkleNodes: ITEMS_MSOL.length,
      maxTotalClaim: totalClaimMsol,
    }))
    stakeAccountFrom = await createSettlementFundedInitializedStake({
      program,
      provider,
      lamports: 10 * LAMPORTS_PER_SOL,
      configAccount,
      settlementAccount,
    })
  })

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

  async function claimIx(
    leaf: MerkleTreeNodeWithProof,
    stakeAccountTo: PublicKey,
    liquidAccounts: {
      marinadeLiquidState?: PublicKey | null
      marinadeLiquidStakeList?: PublicKey | null
    } = {},
  ) {
    const { instruction } = await claimSettlementV2Instruction({
      program,
      claimAmount: leaf.treeNode.claim,
      index: leaf.treeNode.index,
      merkleProof: leaf.proof,
      settlementAccount,
      stakeAccountFrom,
      stakeAccountTo,
      stakeAccountStaker: leaf.treeNode.stakeAuthority,
      stakeAccountWithdrawer: leaf.treeNode.withdrawAuthority,
      ...liquidAccounts,
    })
    return instruction
  }

  async function expectClaimed(
    leaf: MerkleTreeNodeWithProof,
    stakeAccountTo: PublicKey,
  ) {
    expect(
      await isClaimed(program, settlementAccount, leaf.treeNode.index),
    ).toBe(true)
    expect(
      (await provider.connection.getAccountInfo(stakeAccountTo))?.lamports,
    ).toEqual(2 * LAMPORTS_PER_SOL + leaf.treeNode.claim.toNumber())
  }

  async function expectError(
    ix: Awaited<ReturnType<typeof claimIx>>,
    code: number,
    message: string,
  ) {
    await warpOffsetSlot(provider, 1)
    try {
      await provider.sendIx([], ix)
      throw new Error(`failure expected; error ${code}`)
    } catch (e) {
      verifyError(e, Errors, code, message)
    }
  }

  it('claims into a listed stake account', async () => {
    const leaf = leafAt(0)
    const stakeAccountTo = await destinationFor(leaf)
    injectValidMarinadeLiquidAccounts(provider, {
      listed: [undefined, stakeAccountTo, undefined],
    })
    await provider.sendIx([], await claimIx(leaf, stakeAccountTo))
    await expectClaimed(leaf, stakeAccountTo)
  })

  it('rejects an unlisted or stale stake account', async () => {
    const leaf = leafAt(3)
    const unlisted = await destinationFor(leaf)
    injectValidMarinadeLiquidAccounts(provider, {
      listed: [undefined, undefined],
    })
    await expectError(
      await claimIx(leaf, unlisted),
      6080,
      'not in the Marinade liquid stake list',
    )

    const stale = await destinationFor(leaf)
    injectValidMarinadeLiquidAccounts(provider, {
      listed: [undefined, undefined, stale],
      count: 2,
    })
    await expectError(
      await claimIx(leaf, stale),
      6080,
      'not in the Marinade liquid stake list',
    )
    expect(
      await isClaimed(program, settlementAccount, leaf.treeNode.index),
    ).toBe(false)
  })

  it('requires the liquid accounts', async () => {
    const leaf = leafAt(3)
    const stakeAccountTo = await destinationFor(leaf)
    injectValidMarinadeLiquidAccounts(provider, { listed: [stakeAccountTo] })
    await expectError(
      await claimIx(leaf, stakeAccountTo, {
        marinadeLiquidState: null,
        marinadeLiquidStakeList: null,
      }),
      6081,
      'accounts are required for the mSOL withdrawer',
    )
    await expectError(
      await claimIx(leaf, stakeAccountTo, { marinadeLiquidStakeList: null }),
      6081,
      'accounts are required for the mSOL withdrawer',
    )
  })

  it('rejects invalid liquid accounts', async () => {
    const leaf = leafAt(3)
    const stakeAccountTo = await destinationFor(leaf)
    const stateData = buildMarinadeLiquidState({
      stakeList: MARINADE_LIQUID_STAKE_LIST,
      count: 1,
    })
    const stakeListData = buildMarinadeLiquidStakeList({
      records: [stakeAccountTo],
    })
    const invalid = 'Marinade liquid State or stake list account is invalid'

    injectMarinadeLiquidAccounts(provider, { stateData, stakeListData })
    await expectError(
      await claimIx(leaf, stakeAccountTo, {
        marinadeLiquidState: MARINADE_LIQUID_STAKE_LIST,
        marinadeLiquidStakeList: MARINADE_LIQUID_STAKE_LIST,
      }),
      6082,
      invalid,
    )

    injectMarinadeLiquidAccounts(provider, {
      stateData,
      stakeListData,
      stateOwner: SystemProgram.programId,
    })
    await expectError(await claimIx(leaf, stakeAccountTo), 6082, invalid)

    injectMarinadeLiquidAccounts(provider, {
      stateData,
      stakeListData,
      stakeListOwner: SystemProgram.programId,
    })
    await expectError(await claimIx(leaf, stakeAccountTo), 6082, invalid)

    const otherStakeList = Keypair.generate().publicKey
    injectMarinadeLiquidAccounts(provider, {
      stateData,
      stakeListData,
      stakeList: otherStakeList,
    })
    await expectError(
      await claimIx(leaf, stakeAccountTo, {
        marinadeLiquidStakeList: otherStakeList,
      }),
      6082,
      invalid,
    )

    injectMarinadeLiquidAccounts(provider, {
      stateData,
      stakeListData: buildMarinadeLiquidStakeList({
        records: [stakeAccountTo],
        discriminator: 'stakerXX',
      }),
    })
    await expectError(await claimIx(leaf, stakeAccountTo), 6082, invalid)

    injectMarinadeLiquidAccounts(provider, {
      stateData: buildMarinadeLiquidState({
        stakeList: MARINADE_LIQUID_STAKE_LIST,
        count: 2,
      }),
      stakeListData,
    })
    await expectError(await claimIx(leaf, stakeAccountTo), 6082, invalid)

    expect(
      await isClaimed(program, settlementAccount, leaf.treeNode.index),
    ).toBe(false)
  })

  it('leaves other withdrawers unchanged', async () => {
    injectValidMarinadeLiquidAccounts(provider, { listed: [undefined] })

    const leafWithAccounts = leafAt(4)
    const stakeAccountTo4 = await destinationFor(leafWithAccounts)
    await provider.sendIx(
      [],
      await claimIx(leafWithAccounts, stakeAccountTo4, {
        marinadeLiquidState: MARINADE_LIQUID_STATE,
        marinadeLiquidStakeList: MARINADE_LIQUID_STAKE_LIST,
      }),
    )
    await expectClaimed(leafWithAccounts, stakeAccountTo4)

    const leafWithout = leafAt(5)
    const stakeAccountTo5 = await destinationFor(leafWithout)
    await provider.sendIx([], await claimIx(leafWithout, stakeAccountTo5))
    await expectClaimed(leafWithout, stakeAccountTo5)
  })

  it('fits the default compute budget up to the stake list capacity', async () => {
    for (const [leaf, count] of [
      [leafAt(1), MAINNET_STAKE_LIST_COUNT],
      [leafAt(2), STAKE_LIST_CAPACITY],
    ] as const) {
      const stakeAccountTo = await destinationFor(leaf)
      const listed = new Array<PublicKey | undefined>(count).fill(undefined)
      listed[count - 1] = stakeAccountTo
      injectValidMarinadeLiquidAccounts(provider, {
        listed,
        capacity: STAKE_LIST_CAPACITY,
      })
      const meta = await bankrunExecuteIx(
        provider,
        [provider.wallet],
        await claimIx(leaf, stakeAccountTo),
      )
      console.log(
        `claim CU with the destination at index ${count - 1} of ${count}: ${meta.computeUnitsConsumed}`,
      )
      expect(Number(meta.computeUnitsConsumed)).toBeLessThan(200_000)
      await expectClaimed(leaf, stakeAccountTo)
    }
  })
})
