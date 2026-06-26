import fs from 'fs'
import os from 'os'
import path from 'path'

import { extendJestWithShellMatchers } from '@marinade.finance/jest-shell-matcher'
import {
  bondAddress,
  bondsWithdrawerAuthority,
  findStakeAccounts,
  settlementAddress,
  settlementStakerAuthority,
} from '@marinade.finance/validator-bonds-sdk'
import { createDelegatedStakeAccount } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/staking'
import { createVoteAccount } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/staking'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testTransactions'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testValidator'
import {
  createTempFileKeypair,
  createUserAndFund,
  waitForNextEpoch,
} from '@marinade.finance/web3js-1x'
import { LAMPORTS_PER_SOL, StakeProgram } from '@solana/web3.js'
import BN from 'bn.js'

import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { ValidatorBondsProgram } from '@marinade.finance/validator-bonds-sdk'
import type { Keypair } from '@solana/web3.js'

const JEST_TIMEOUT_MS = 3000_000
jest.setTimeout(JEST_TIMEOUT_MS)

// 32-byte merkle root; the swap does not touch claim accounting, so a synthetic
// root that no claim proves against is fine — we only fund + swap the settlement.
const MERKLE_ROOT = Array.from({ length: 32 }, (_, i) => i + 1)

function keypairBase64(keypair: Keypair): string {
  return '[' + keypair.secretKey.toString() + ']'
}

// Binary-level proof that `fund-settlement` performs the SwapSettlementStake swap:
// a bond-funded settlement's still-deactivating stake is handed to the marinade
// reserve wallet and replaced by a reserve stake re-delegated THIS epoch, so the
// settlement becomes claimable in the same epoch it was funded.
describe('Pipeline fund-settlement swap', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let merkleTreesDir: string

  beforeAll(() => {
    extendJestWithShellMatchers()
    ;({ provider, program } = initTest('confirmed'))
    merkleTreesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swap-pipeline-'))
  })

  afterAll(() => {
    if (merkleTreesDir && fs.existsSync(merkleTreesDir)) {
      fs.rmSync(merkleTreesDir, { recursive: true, force: true })
    }
  })

  it('funds a bond settlement and swaps it claimable in the same epoch', async () => {
    // build the binary before driving it
    await expect([
      'cargo',
      ['build', '--bin', 'fund-settlement'],
    ]).toHaveMatchingSpawnOutput({ code: 0 })

    const {
      path: operatorAuthorityPath,
      keypair: operatorAuthority,
      cleanup: operatorCleanup,
    } = await createTempFileKeypair()
    const { configAccount } = await executeInitConfigInstruction({
      program,
      provider,
      operatorAuthority,
      epochsToClaimSettlement: 100_000,
      slotsToStartSettlementClaiming: 5,
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
    const [bondAccount] = bondAddress(
      configAccount,
      voteAccount,
      program.programId,
    )
    const [withdrawerAuthority] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )

    // a delegated bond stake the funding pass will split into the settlement
    await createDelegatedStakeAccount({
      provider,
      lamports: new BN(3 * LAMPORTS_PER_SOL),
      voteAccount,
      staker: withdrawerAuthority,
      withdrawer: withdrawerAuthority,
    })
    // activate it (the funding instruction splits a delegated bond stake)
    await waitForNextEpoch(provider.connection, 45)
    await waitForNextEpoch(provider.connection, 45)

    const currentEpoch = (await provider.connection.getEpochInfo()).epoch
    const maxTotalClaim = new BN(0.5 * LAMPORTS_PER_SOL)
    const { settlementAccount } = await executeInitSettlement({
      program,
      provider,
      configAccount,
      voteAccount,
      operatorAuthority,
      currentEpoch,
      merkleRoot: MERKLE_ROOT,
      maxMerkleNodes: 1,
      maxTotalClaim,
    })
    const [settlementStakerAuth] = settlementStakerAuthority(
      settlementAccount,
      program.programId,
    )
    const [settlementDerived] = settlementAddress(
      bondAccount,
      MERKLE_ROOT,
      currentEpoch,
      program.programId,
    )

    // merkle-tree collection the binary loads: one ValidatorBond-funded settlement
    const merkleCollection = {
      epoch: currentEpoch,
      slot: currentEpoch * 32,
      validator_bonds_config: configAccount.toBase58(),
      merkle_trees: [
        {
          merkle_root: MERKLE_ROOT,
          max_total_claim_sum: maxTotalClaim.toNumber(),
          max_total_claims: 1,
          vote_account: voteAccount.toBase58(),
          bond_account: bondAccount.toBase58(),
          settlement_account: settlementDerived.toBase58(),
          funding_sources: { ValidatorBond: maxTotalClaim.toNumber() },
          tree_nodes: [
            {
              stake_authority: voteAccount.toBase58(),
              withdraw_authority: voteAccount.toBase58(),
              claim: maxTotalClaim.toNumber(),
              index: 0,
              proof: null,
            },
          ],
        },
      ],
    }
    const jsonPath = path.join(
      merkleTreesDir,
      `${currentEpoch}_merkle-trees.json`,
    )
    fs.writeFileSync(jsonPath, JSON.stringify(merkleCollection))

    // marinade reserve wallet: the swap sources a fresh reserve stake from it
    const marinadeReserve = (await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL * 100,
    })) as Keypair
    const feePayer = (await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL * 1000,
    })) as Keypair

    // before the swap the reserve holds no stake accounts
    const reserveStakesBefore = await findStakeAccounts({
      connection: provider.connection,
      staker: marinadeReserve.publicKey,
    })
    expect(reserveStakesBefore.length).toEqual(0)

    const reportFile = path.join(merkleTreesDir, 'fund-report.txt')
    await expect([
      'cargo',
      [
        'run',
        '--bin',
        'fund-settlement',
        '--',
        '--operator-authority',
        operatorAuthorityPath,
        '--config',
        configAccount.toBase58(),
        '--rpc-url',
        provider.connection.rpcEndpoint,
        '-f',
        jsonPath,
        '--epoch',
        currentEpoch.toString(),
        '--fee-payer',
        keypairBase64(feePayer),
        '--marinade-wallet',
        keypairBase64(marinadeReserve),
        '--report-file',
        reportFile,
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
    })

    // the swap handed the settlement's original bond stake to the reserve wallet
    const reserveStakesAfter = await findStakeAccounts({
      connection: provider.connection,
      staker: marinadeReserve.publicKey,
      currentEpoch,
    })
    expect(reserveStakesAfter.length).toBeGreaterThanOrEqual(1)

    // the settlement-owned stake is now the reserve stake, re-delegated to the
    // validator THIS epoch and deactivated the same epoch -> claimable now
    const settlementStakes = await findStakeAccounts({
      connection: provider.connection,
      staker: settlementStakerAuth,
      currentEpoch,
    })
    expect(settlementStakes.length).toEqual(1)
    const settlementStake = settlementStakes[0]!.account.data
    expect(settlementStake.voter).toEqual(voteAccount)
    expect(settlementStake.activationEpoch?.toNumber()).toEqual(currentEpoch)
    expect(settlementStake.deactivationEpoch?.toNumber()).toEqual(currentEpoch)

    await operatorCleanup()
  })

  it('reuses a deactivated reserve stake by splitting it across validators', async () => {
    const {
      path: operatorAuthorityPath,
      keypair: operatorAuthority,
      cleanup: operatorCleanup,
    } = await createTempFileKeypair()
    const { configAccount } = await executeInitConfigInstruction({
      program,
      provider,
      operatorAuthority,
      epochsToClaimSettlement: 100_000,
      slotsToStartSettlementClaiming: 5,
    })
    const [withdrawerAuthority] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )

    // the settlement's validator + bond + a delegated bond stake to fund from
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
    const [bondAccount] = bondAddress(
      configAccount,
      voteAccount,
      program.programId,
    )
    await createDelegatedStakeAccount({
      provider,
      lamports: new BN(3 * LAMPORTS_PER_SOL),
      voteAccount,
      staker: withdrawerAuthority,
      withdrawer: withdrawerAuthority,
    })

    // a marinade-owned reserve stake delegated to a DIFFERENT validator and
    // deactivated — modelling a stake received from a prior swap. It is larger
    // than the settlement, so the pass must SPLIT it and re-delegate the piece to
    // the settlement's validator (cross-validator reserve reuse).
    const marinadeReserve = (await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL * 2,
    })) as Keypair
    const { voteAccount: reserveVoteAccount } = await createVoteAccount({
      provider,
    })
    const reserveStake = await createDelegatedStakeAccount({
      provider,
      lamports: new BN(5 * LAMPORTS_PER_SOL),
      voteAccount: reserveVoteAccount,
      staker: marinadeReserve.publicKey,
      withdrawer: marinadeReserve.publicKey,
    })
    await provider.sendIx(
      [marinadeReserve],
      StakeProgram.deactivate({
        stakePubkey: reserveStake,
        authorizedPubkey: marinadeReserve.publicKey,
      }),
    )

    // activate the bond stake (the reserve stays effective-0 / deactivated)
    await waitForNextEpoch(provider.connection, 45)
    await waitForNextEpoch(provider.connection, 45)

    const currentEpoch = (await provider.connection.getEpochInfo()).epoch
    const maxTotalClaim = new BN(0.5 * LAMPORTS_PER_SOL)
    const { settlementAccount } = await executeInitSettlement({
      program,
      provider,
      configAccount,
      voteAccount,
      operatorAuthority,
      currentEpoch,
      merkleRoot: MERKLE_ROOT,
      maxMerkleNodes: 1,
      maxTotalClaim,
    })
    const [settlementStakerAuth] = settlementStakerAuthority(
      settlementAccount,
      program.programId,
    )
    const [settlementDerived] = settlementAddress(
      bondAccount,
      MERKLE_ROOT,
      currentEpoch,
      program.programId,
    )
    const merkleCollection = {
      epoch: currentEpoch,
      slot: currentEpoch * 32,
      validator_bonds_config: configAccount.toBase58(),
      merkle_trees: [
        {
          merkle_root: MERKLE_ROOT,
          max_total_claim_sum: maxTotalClaim.toNumber(),
          max_total_claims: 1,
          vote_account: voteAccount.toBase58(),
          bond_account: bondAccount.toBase58(),
          settlement_account: settlementDerived.toBase58(),
          funding_sources: { ValidatorBond: maxTotalClaim.toNumber() },
          tree_nodes: [
            {
              stake_authority: voteAccount.toBase58(),
              withdraw_authority: voteAccount.toBase58(),
              claim: maxTotalClaim.toNumber(),
              index: 0,
              proof: null,
            },
          ],
        },
      ],
    }
    const jsonPath = path.join(
      merkleTreesDir,
      `${currentEpoch}_split_merkle-trees.json`,
    )
    fs.writeFileSync(jsonPath, JSON.stringify(merkleCollection))
    const feePayer = (await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL * 1000,
    })) as Keypair

    const reserveLamportsBefore = (await provider.connection.getAccountInfo(
      reserveStake,
    ))!.lamports

    const reportFile = path.join(merkleTreesDir, 'split-report.txt')
    await expect([
      'cargo',
      [
        'run',
        '--bin',
        'fund-settlement',
        '--',
        '--operator-authority',
        operatorAuthorityPath,
        '--config',
        configAccount.toBase58(),
        '--rpc-url',
        provider.connection.rpcEndpoint,
        '-f',
        jsonPath,
        '--epoch',
        currentEpoch.toString(),
        '--fee-payer',
        keypairBase64(feePayer),
        '--marinade-wallet',
        keypairBase64(marinadeReserve),
        '--report-file',
        reportFile,
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
    })

    // the reserve stake was split (shrank) to provide the swap input
    const reserveLamportsAfter = (await provider.connection.getAccountInfo(
      reserveStake,
    ))!.lamports
    expect(reserveLamportsAfter).toBeLessThan(reserveLamportsBefore)

    // the settlement-owned stake is the split piece, re-delegated to the
    // settlement's validator (not the reserve's) and deactivated this epoch
    const settlementStakes = await findStakeAccounts({
      connection: provider.connection,
      staker: settlementStakerAuth,
      currentEpoch,
    })
    expect(settlementStakes.length).toEqual(1)
    const settlementStake = settlementStakes[0]!.account.data
    expect(settlementStake.voter).toEqual(voteAccount)
    expect(settlementStake.activationEpoch?.toNumber()).toEqual(currentEpoch)
    expect(settlementStake.deactivationEpoch?.toNumber()).toEqual(currentEpoch)

    await operatorCleanup()
  })
})
