import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { getAnchorValidatorInfo } from '@marinade.finance/anchor-common'
import { extendJestWithShellMatchers } from '@marinade.finance/jest-shell-matcher'
import {
  fundSettlementInstruction,
  isClaimed,
} from '@marinade.finance/validator-bonds-sdk'
import {
  ITEMS_MSOL,
  MERKLE_ROOT_MSOL_BUF,
  msolStaker,
  msolWithdrawer,
  totalClaimMsol,
} from '@marinade.finance/validator-bonds-sdk/__tests__/utils/merkleTreeTestData'
import {
  createBondsFundedStakeAccount,
  createDelegatedStakeAccount,
  createInitializedStakeAccount,
  createVoteAccount,
  isErrorEpochRewardsPeriod,
} from '@marinade.finance/validator-bonds-sdk/__tests__/utils/staking'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testTransactions'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testValidator'
import {
  createUserAndFund,
  getStakeAccount,
  signer,
  waitForEpoch,
} from '@marinade.finance/web3js-1x'
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'

import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { ValidatorBondsProgram } from '@marinade.finance/validator-bonds-sdk'
import type { Keypair } from '@solana/web3.js'

// mainnet stake accounts listed in the mainnet stake list, loaded from fixtures/accounts-marinade-liquid
const LISTED_STAKE_ACCOUNTS = [
  new PublicKey('3tGbZed4ZfxR56CjxQW5kAghcz5gr7fzcXisWFkhdjeG'),
  new PublicKey('2j8WmiHcr3TEEBfsKpfdkXhmq2NVGrbXEW3vWFn2uQFd'),
]

describe('Cargo CLI: claim settlement of Marinade liquid leaves', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let settlementAccount: PublicKey
  let settlementEpoch: number
  let voteAccount: PublicKey
  let unlistedStakeAccount: PublicKey
  let merkleTreesDir: string

  beforeAll(async () => {
    extendJestWithShellMatchers()
    ;({ provider, program } = initTest('processed'))
    const { validatorIdentity } = await getAnchorValidatorInfo(
      provider.connection,
    )
    let operatorAuthority: Keypair
    ;({ configAccount, operatorAuthority } = await executeInitConfigInstruction(
      {
        program,
        provider,
        epochsToClaimSettlement: 100_000,
      },
    ))
    ;({ voteAccount } = await createVoteAccount({
      provider,
      validatorIdentity,
    }))
    await executeInitBondInstruction({
      configAccount,
      program,
      provider,
      voteAccount,
      validatorIdentity,
    })
    const settlement = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      merkleRoot: MERKLE_ROOT_MSOL_BUF,
      maxMerkleNodes: ITEMS_MSOL.length,
      maxTotalClaim: totalClaimMsol,
    })
    settlementAccount = settlement.settlementAccount
    settlementEpoch = settlement.epoch.toNumber()
    const stakeAccount = await createBondsFundedStakeAccount({
      program,
      provider,
      configAccount,
      voteAccount,
      lamports: totalClaimMsol.toNumber() + LAMPORTS_PER_SOL * 10,
    })
    const { instruction: fundIx, splitStakeAccount } =
      await fundSettlementInstruction({
        program,
        settlementAccount,
        stakeAccount,
      })
    while (true) {
      try {
        await provider.sendIx(
          [signer(splitStakeAccount), operatorAuthority],
          fundIx,
        )
      } catch (e) {
        if (isErrorEpochRewardsPeriod(e)) {
          continue
        }
        throw e
      }
      break
    }

    ;({ stakeAccount: unlistedStakeAccount } =
      await createInitializedStakeAccount({
        provider,
        staker: msolStaker,
        withdrawer: msolWithdrawer,
      }))
    for (const { treeNode } of ITEMS_MSOL.filter(
      item => !item.treeNode.withdrawAuthority.equals(msolWithdrawer),
    )) {
      await createDelegatedStakeAccount({
        provider,
        lamports: 2 * LAMPORTS_PER_SOL,
        voteAccount,
        staker: treeNode.stakeAuthority,
        withdrawer: treeNode.withdrawAuthority,
      })
    }

    // stake activated before being deactivated by funding stays effective until next epoch; claim withdraw would fail
    const { activationEpoch, deactivationEpoch } = await getStakeAccount(
      provider.connection,
      stakeAccount,
    )
    assert(activationEpoch !== null && deactivationEpoch !== null)
    if (deactivationEpoch.gt(activationEpoch)) {
      await waitForEpoch(
        provider.connection,
        deactivationEpoch.toNumber() + 1,
        180,
      )
    }

    merkleTreesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settlement-msol-'))
  })

  afterAll(() => {
    if (merkleTreesDir && fs.existsSync(merkleTreesDir)) {
      fs.rmSync(merkleTreesDir, { recursive: true, force: true })
    }
  })

  it('claims liquid leaves only into stake list members', async () => {
    const merkleTreeCollectionPath = path.join(
      merkleTreesDir,
      `${settlementEpoch}_settlement-merkle-trees.json`,
    )
    fs.writeFileSync(
      merkleTreeCollectionPath,
      JSON.stringify({
        epoch: settlementEpoch,
        slot: 0,
        validator_bonds_config: configAccount.toBase58(),
        merkle_trees: [
          {
            merkle_root: Array.from(MERKLE_ROOT_MSOL_BUF),
            max_total_claim_sum: totalClaimMsol.toNumber(),
            max_total_claims: ITEMS_MSOL.length,
            vote_account: voteAccount.toBase58(),
            tree_nodes: ITEMS_MSOL.map(({ treeNode, proof }) => ({
              stake_authority: treeNode.stakeAuthority.toBase58(),
              withdraw_authority: treeNode.withdrawAuthority.toBase58(),
              claim: treeNode.data.claim.toNumber(),
              index: treeNode.data.index.toNumber(),
              proof,
            })),
          },
        ],
      }),
    )

    const listedLamportsBefore = await lamportsOf(
      provider,
      LISTED_STAKE_ACCOUNTS,
    )
    const unlistedLamportsBefore = await lamportsOf(provider, [
      unlistedStakeAccount,
    ])

    const feePayer = await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL * 10,
    })
    const reportFile = path.join(merkleTreesDir, 'claim-report.txt')
    await expect([
      'cargo',
      [
        'run',
        '--bin',
        'claim-settlement',
        '--',
        '--config',
        configAccount.toBase58(),
        '--rpc-url',
        provider.connection.rpcEndpoint,
        '-f',
        merkleTreeCollectionPath,
        '--epoch',
        settlementEpoch.toString(),
        '--fee-payer',
        '[' + (feePayer as Keypair).secretKey.toString() + ']',
        '--report-file',
        reportFile,
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
    })
    expect(fs.readFileSync(reportFile, 'utf-8')).toMatch(
      new RegExp(
        `claimed ${ITEMS_MSOL.length}/${ITEMS_MSOL.length} merkle nodes`,
      ),
    )

    for (const { treeNode } of ITEMS_MSOL) {
      expect(
        await isClaimed(program, settlementAccount, treeNode.data.index),
      ).toBeTruthy()
    }
    const msolClaimed = ITEMS_MSOL.filter(item =>
      item.treeNode.withdrawAuthority.equals(msolWithdrawer),
    ).reduce((acc, item) => acc + item.treeNode.data.claim.toNumber(), 0)
    expect(await lamportsOf(provider, LISTED_STAKE_ACCOUNTS)).toEqual(
      listedLamportsBefore + msolClaimed,
    )
    expect(await lamportsOf(provider, [unlistedStakeAccount])).toEqual(
      unlistedLamportsBefore,
    )
  })
})

async function lamportsOf(
  provider: AnchorExtendedProvider,
  accounts: PublicKey[],
): Promise<number> {
  const infos = await provider.connection.getMultipleAccountsInfo(accounts)
  return infos.reduce((acc, info) => {
    assert(info !== null)
    return acc + info.lamports
  }, 0)
}
