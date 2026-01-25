/* eslint-disable jest/no-disabled-tests */

import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { extendJestWithShellMatchers } from '@marinade.finance/jest-shell-matcher'
import { sleep } from '@marinade.finance/ts-common'
import {
  bondAddress,
  bondsWithdrawerAuthority,
  findConfigStakeAccounts,
  findSettlements,
  findStakeAccountNoDataInfos,
  getMultipleSettlements,
  getRentExemptStake,
  settlementAddress,
} from '@marinade.finance/validator-bonds-sdk'
import { getSecureRandomInt } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/helpers'
import { createDelegatedStakeAccount } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/staking'
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
import {
  Authorized,
  Keypair,
  LAMPORTS_PER_SOL,
  Lockup,
  PublicKey,
  StakeProgram,
} from '@solana/web3.js'
import BN from 'bn.js'

import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { ValidatorBondsProgram } from '@marinade.finance/validator-bonds-sdk'
import type { TransactionInstruction } from '@solana/web3.js'

const JEST_TIMEOUT_MS = 3000_000
jest.setTimeout(JEST_TIMEOUT_MS)

// 4Kak81y61aAcSYnGyVZAsA1kzypesF4bV5azqEoGZnsX
const VOTE_ACCOUNT_IDENTITY = Keypair.fromSecretKey(
  new Uint8Array([
    46, 122, 115, 233, 205, 38, 160, 89, 108, 12, 253, 183, 136, 97, 7, 157, 83,
    175, 62, 146, 129, 33, 153, 77, 189, 254, 166, 210, 202, 33, 248, 158, 49,
    85, 171, 80, 177, 237, 201, 127, 92, 110, 192, 28, 134, 162, 226, 7, 226,
    156, 183, 23, 80, 139, 58, 54, 160, 186, 75, 85, 77, 212, 82, 182,
  ]),
)
// const VOTE_ACCOUNT_WITHDRAWER = Keypair.fromSecretKey(
//   new Uint8Array([
//     36, 140, 47, 220, 125, 52, 60, 54, 208, 146, 200, 76, 12, 1, 138, 158, 105,
//     44, 172, 88, 252, 167, 76, 55, 187, 56, 224, 117, 69, 233, 148, 186, 144, 3,
//     69, 190, 84, 246, 127, 228, 121, 88, 60, 225, 159, 165, 142, 161, 106, 238,
//     14, 161, 165, 250, 245, 152, 35, 130, 125, 133, 168, 146, 126, 104,
//   ])
// )

// NOTE: This test case is skipped by default as it takes a long time to run
//       The tests uses a real data from epoch 601 and needs to setup all parts and create 10K settlements
//       Activate and run this manually when needed.
//       FILE='settlement-pipelines/__tests__/test-validator/pipelineSettlement.spec.ts' pnpm test:validator

describe.skip('Cargo CLI: Pipeline Settlement', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram

  let operatorAuthorityPath: string
  let operatorAuthorityKeypair: Keypair
  let operatorAuthorityCleanup: () => Promise<void>
  let bondAuthorityKeypair: Keypair
  let bondAuthorityCleanup: () => Promise<void>

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let loadedJson: any
  let configAccount: PublicKey
  const settlementAddresses: PublicKey[] = []
  const testData: {
    voteAccount: PublicKey
    bondAccount: PublicKey
    bondAuthority: Keypair
  }[] = []
  let merkleTreesDir: string
  let merkleTreeCollectionPath: string
  let currentEpoch: number
  let stakeAccountsCreationFuture: Promise<void>
  let stakeAccountsNumber: number

  // The test flow is pretty heavy and one part depends on the other.
  // The tests are run in order and the previous test is checked to be run.
  enum TestNames {
    None,
    InitSettlement,
    ListClaimableEpoch,
    ClaimSettlement,
  }
  let previousTest = TestNames.None

  beforeAll(async () => {
    extendJestWithShellMatchers()
    ;({ provider, program } = initTest('processed'))
    ;({
      path: operatorAuthorityPath,
      keypair: operatorAuthorityKeypair,
      cleanup: operatorAuthorityCleanup,
    } = await createTempFileKeypair())
    ;({
      // path: bondAuthorityPath,
      keypair: bondAuthorityKeypair,
      cleanup: bondAuthorityCleanup,
    } = await createTempFileKeypair())

    // Order of tests is important and all have to be run at once
    const fileEpoch = 601
    const sourceDir = path.join(__dirname, '..', 'data')
    const sourcePath = path.join(
      sourceDir,
      fileEpoch + '_settlement-merkle-trees.json',
    )
    assert(fs.existsSync(sourcePath))
    const fileBuffer = fs.readFileSync(sourcePath)
    loadedJson = JSON.parse(fileBuffer.toString())
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
      operatorAuthority: operatorAuthorityKeypair,
      epochsToClaimSettlement: 100_000,
      slotsToStartSettlementClaiming: 5,
      withdrawLockupEpochs: 0,
    }))

    // Inject dynamic config address into JSON and write to temp dir
    loadedJson.validator_bonds_config = configAccount.toBase58()
    merkleTreesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'settlement-test-'))
    merkleTreeCollectionPath = path.join(
      merkleTreesDir,
      fileEpoch + '_settlement-merkle-trees.json',
    )
    fs.writeFileSync(merkleTreeCollectionPath, JSON.stringify(loadedJson))

    // preparing target stake accounts for all settlements claiming
    const stakers: PublicKey[] = []
    const withdrawers: PublicKey[] = []
    for (const merkleTree of loadedJson.merkle_trees) {
      for (const treeNode of merkleTree.tree_nodes) {
        stakers.push(new PublicKey(treeNode.stake_authority))
        withdrawers.push(new PublicKey(treeNode.withdraw_authority))
      }
    }
    stakeAccountsCreationFuture = chunkedCreateInitializedStakeAccounts({
      provider,
      stakers,
      withdrawers,
    })
    stakeAccountsNumber = stakers.length

    const beforeEpoch = (await program.provider.connection.getEpochInfo()).epoch
    for (const merkleTree of loadedJson.merkle_trees) {
      const voteAccount = new PublicKey(merkleTree.vote_account)
      const [bondAccount] = bondAddress(
        configAccount,
        voteAccount,
        program.programId,
      )
      const [settlementAccount] = settlementAddress(
        bondAccount,
        merkleTree.merkle_root,
        beforeEpoch,
        program.programId,
      )
      settlementAddresses.push(settlementAccount)
      if (
        !testData
          .map(v => v.voteAccount.toBase58())
          .includes(voteAccount.toBase58())
      ) {
        testData.push(
          await executeInitBondInstruction({
            program,
            provider,
            configAccount,
            bondAuthority: bondAuthorityKeypair,
            voteAccount,
            validatorIdentity: VOTE_ACCOUNT_IDENTITY,
            cpmpe: 0,
          }),
        )
      }
    }
  })

  afterAll(async () => {
    await bondAuthorityCleanup()
    await operatorAuthorityCleanup()
    if (merkleTreesDir && fs.existsSync(merkleTreesDir)) {
      fs.rmSync(merkleTreesDir, { recursive: true, force: true })
    }
  })

  it('init settlements', async () => {
    assert(previousTest === TestNames.None)
    await // build the rust before running the tests
    expect(['cargo', ['build']]).toHaveMatchingSpawnOutput({
      code: 0,
    })

    const randomMerkleTree =
      loadedJson.merkle_trees[
        getSecureRandomInt(0, loadedJson.merkle_trees.length - 1)
      ]
    currentEpoch = (await program.provider.connection.getEpochInfo()).epoch
    await executeInitSettlement({
      program,
      provider,
      configAccount,
      voteAccount: new PublicKey(randomMerkleTree.vote_account),
      operatorAuthority: operatorAuthorityKeypair,
      currentEpoch,
      merkleRoot: randomMerkleTree.merkle_root,
      maxMerkleNodes: new BN(randomMerkleTree.max_total_claims),
      maxTotalClaim: new BN(randomMerkleTree.max_total_claim_sum),
    })

    const feePayer = await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL * 100_000,
    })
    const feePayerBase64 =
      '[' + (feePayer as Keypair).secretKey.toString() + ']'

    // waiting for get data finalized on-chain
    await waitForNextEpoch(provider.connection, 15)

    const stdErrExecutionResult = RegExp(
      settlementAddresses.length -
        1 +
        ' executed successfully(.|\n|\r)*' +
        'Upsize Settlement Claims.*0 executed successfully',
    )
    await expect([
      'cargo',
      [
        'run',
        '--bin',
        'init-settlement',
        '--',
        '--operator-authority',
        operatorAuthorityPath,
        '--config',
        configAccount.toBase58(),
        '--rpc-url',
        provider.connection.rpcEndpoint,
        '-m',
        merkleTreeCollectionPath,
        '--epoch',
        currentEpoch.toString(),
        '--fee-payer',
        feePayerBase64,
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      stdout: /sum merkle nodes: 12397(.|\n|\r)*upsized settlements 0/,
      stderr: stdErrExecutionResult,
    })

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
        merkleTreeCollectionPath,
        '--epoch',
        currentEpoch.toString(),
        '--fee-payer',
        feePayerBase64,
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 99, // code 99 => Warning, test did not prepare all stake accounts
      stdout: /funded 0.10 settlements/,
      stderr: /no stake account available/,
    })

    await expect([
      'cargo',
      [
        'run',
        '--bin',
        'init-settlement',
        '--',
        '--operator-authority',
        operatorAuthorityPath,
        '--config',
        configAccount.toBase58(),
        '--rpc-url',
        provider.connection.rpcEndpoint,
        '-m',
        merkleTreeCollectionPath,
        '--epoch',
        currentEpoch.toString(),
        '--fee-payer',
        feePayerBase64,
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      stdout: /created 0.10 settlements/,
      stderr: /0 executed successfully/,
    })

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
        merkleTreeCollectionPath,
        '--epoch',
        currentEpoch.toString(),
        '--fee-payer',
        feePayerBase64,
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 99,
      stdout: /funded 0.10 settlements/,
      stderr: /no stake account available/,
    })

    await waitForNextEpoch(provider.connection, 15)

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
        merkleTreeCollectionPath,
        '--epoch',
        currentEpoch.toString(),
        '--fee-payer',
        feePayerBase64,
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 99,
      stdout: /funded 0.10 settlements/,
      stderr: /no stake account available/,
    })

    const createdSettlements = await findSettlements({
      program,
      epoch: currentEpoch,
    })
    expect(createdSettlements.length).toEqual(settlementAddresses.length)
    let settlementsData = await getMultipleSettlements({
      program,
      addresses: settlementAddresses,
    })
    expect(settlementsData.length).toEqual(settlementAddresses.length)
    let counter = 0
    while (
      settlementsData.filter(s => s.account !== null).length !==
        settlementAddresses.length &&
      counter++ < 10
    ) {
      await sleep(1000)
      settlementsData = await getMultipleSettlements({
        program,
        addresses: settlementAddresses,
      })
    }

    const [withdrawerAuthority] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )
    // Creating stake accounts to fund settlements
    // the number of accounts is based on max_total_claim_sum and amount_to_fund per settlement
    // expecting all settlements are funded in steps of 1.2 SOL in every stake account
    for (const merkleTree of loadedJson.merkle_trees) {
      const voteAccount = new PublicKey(merkleTree.vote_account)
      expect(merkleTree.max_total_claim_sum).toBeDefined()
      const lamportsToFund = new BN(merkleTree.max_total_claim_sum)
      let lamportsStep = new BN(1.2 * LAMPORTS_PER_SOL)
      let lamportsAtStakeAccounts = new BN(0)
      while (lamportsAtStakeAccounts.lt(lamportsToFund)) {
        await createDelegatedStakeAccount({
          provider,
          lamports: lamportsStep,
          voteAccount,
          withdrawer: withdrawerAuthority,
          staker: withdrawerAuthority,
        })
        lamportsAtStakeAccounts = lamportsAtStakeAccounts.add(lamportsStep)
        lamportsStep = lamportsStep.add(lamportsStep)
      }
    }
    // activating stake accounts
    await waitForNextEpoch(provider.connection, 15)

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
        merkleTreeCollectionPath,
        '--epoch',
        currentEpoch.toString(),
        '--fee-payer',
        feePayerBase64,
      ],
    ]).toHaveMatchingSpawnOutput({
      stdout: /funded 9.10 settlements/,
      stderr:
        // expecting that at least one settlement will be funded with 2 stake accounts
        /will be funded with 2 stake accounts with 2.4 SOLs/,
    })
    // we expected there is 10 settlements (per logs above)
    expect(settlementAddresses.length).toEqual(10)

    const allConfigStakeAccounts = await findConfigStakeAccounts({
      program,
      configAccount,
    })
    const fundedStakeAccounts = allConfigStakeAccounts.filter(
      s => !s.account.data.staker?.equals(withdrawerAuthority),
    )
    // we expect funded 9 of 10; it is not clear if there could be funded all 10
    expect(fundedStakeAccounts.length).toEqual(settlementAddresses.length - 1)

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
        merkleTreeCollectionPath,
        '--epoch',
        currentEpoch.toString(),
        '--fee-payer',
        feePayerBase64,
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 99,
      stdout: /Unknown: funded 0.10 settlements/,
      stderr:
        /already funded.*skipping funding(.|\n|\r)*ixes 0 executed successfully/,
    })
    previousTest = TestNames.InitSettlement
  })

  it('list claimable epochs', async () => {
    assert(previousTest === TestNames.InitSettlement)
    const epochRegexp = new RegExp('[' + currentEpoch + ']')
    await expect([
      'cargo',
      [
        'run',
        '--bin',
        'list-claimable-epoch',
        '--',
        '--config',
        configAccount.toBase58(),
        '--rpc-url',
        provider.connection.rpcEndpoint,
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      stdout: epochRegexp,
    })
    previousTest = TestNames.ListClaimableEpoch
  })

  it('claim settlements', async () => {
    assert(previousTest === TestNames.ListClaimableEpoch)
    const feePayer = await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL * 100_000,
    })
    const feePayerBase64 =
      '[' + (feePayer as Keypair).secretKey.toString() + ']'

    // waiting to next epoch having all stake accounts deactivated
    await waitForNextEpoch(provider.connection, 15)

    console.log('Awaiting stake accounts creation to be finished...')
    await stakeAccountsCreationFuture
    const stakeAccounts = await findStakeAccountNoDataInfos({
      connection: provider,
    })
    // expecting at least 90% of stake accounts to be created; some can be failed in creation (probably 0x10 issue)
    expect(stakeAccounts.length).toBeGreaterThanOrEqual(
      stakeAccountsNumber * 0.9,
    )

    console.log(
      `Claiming settlements;  epoch: ${currentEpoch}, config: ${configAccount.toBase58()} at ${
        provider.connection.rpcEndpoint
      }`,
    )

    // // TESTING purposes to check state manually
    // // cargo run --bin claim-settlement -- --epoch <EPOCH> --config <CONFIG> --rpc-url http://127.0.0.1:8899  -d $PWD/settlement-pipelines/__tests__/data
    // console.log(
    //   `Sleeping for ${
    //     JEST_TIMEOUT_MS / 1000 / 60
    //   } minutes for manual testing...`
    // )
    // await sleep(JEST_TIMEOUT_MS)
    // if (true === true) {
    //   console.log('End of sleeping')
    //   return
    // }

    // expecting retryable errors: settlements are only partially funded
    // (single stake accounts have less than amount_to_fund + minimal_stake),
    // so many claims fail with InsufficientFunds after the funded stake runs out
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
        currentEpoch.toString(),
        '--fee-payer',
        feePayerBase64,
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 100,
      stderr: /custom program error/,
      stdout: /claimed \d+.\d+ merkle nodes/,
    })

    // fund is now run before claiming normally, simulating this situation here
    console.log('Rerunning when partially funded...')
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
        merkleTreeCollectionPath,
        '--epoch',
        currentEpoch.toString(),
        '--fee-payer',
        feePayerBase64,
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 99,
      stdout: /funded 0.10 settlements/,
      stderr: /already funded(.|\n|\r)*0 executed successfully/,
    })

    // re-run claiming: previously claimed nodes should be skipped
    console.log('Rerunning when partially claimed...')
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
        '--json-files',
        merkleTreeCollectionPath,
        '--epoch',
        currentEpoch.toString(),
      ],
    ]).toHaveMatchingSpawnOutput({
      code: 100,
      stderr: /already claimed merkle tree nodes/,
      stdout: /claimed \d+.\d+ merkle nodes/,
    })
    previousTest = TestNames.ClaimSettlement
  })
})

async function chunkedCreateInitializedStakeAccounts({
  provider,
  stakers,
  withdrawers,
}: {
  provider: AnchorExtendedProvider
  stakers: PublicKey[]
  withdrawers: PublicKey[]
}): Promise<void> {
  const rentExempt = await getRentExemptStake(provider)
  expect(stakers.length).toEqual(withdrawers.length)
  // const signers: (Wallet | Keypair | Signer)[] = stakers.map(() => Keypair.generate())

  const combined = stakers.map((staker, index) => {
    return {
      staker,
      withdrawer: withdrawers[index],
      keypair: Keypair.generate(),
    }
  })

  let ixes: TransactionInstruction[] = []
  let signers: Keypair[] = []
  let counter = 0
  let futures: Promise<void>[] = []
  const lockedAccounts = Array.from({ length: 20 }, () =>
    getSecureRandomInt(1, combined.length),
  )
  for (const { staker, withdrawer, keypair } of combined) {
    counter++
    let lockup: Lockup | undefined = undefined
    if (lockedAccounts.includes(counter)) {
      // some accounts will be locked
      lockup = new Lockup(0, Number.MAX_SAFE_INTEGER, PublicKey.default)
    }
    assert(withdrawer !== undefined)
    StakeProgram.createAccount({
      fromPubkey: provider.walletPubkey,
      stakePubkey: keypair.publicKey,
      authorized: new Authorized(staker, withdrawer),
      lamports: rentExempt,
      lockup,
    }).instructions.forEach(ix => {
      ixes.push(ix)
    })
    signers.push(keypair)
    if (ixes.length >= 6) {
      futures.push(provider.sendIx(signers, ...ixes))
      ixes = []
      signers = []
    }
    if (counter % 500 === 0) {
      const results = await Promise.allSettled(futures)
      const failures = results.filter(r => r.status === 'rejected')
      if (failures.length > 0) {
        console.log(
          `Stake accounts batch: ${failures.length}/${results.length} transactions failed`,
        )
      }
      futures = []
    }
    if (counter % 5000 === 0) {
      console.log(`Stake accounts ${counter}/${combined.length} created`)
    }
  }
  console.log(
    `Waiting for counter stake accounts ${counter}/${combined.length} to be created`,
  )
  if (futures.length > 0) {
    const results = await Promise.allSettled(futures)
    const failures = results.filter(r => r.status === 'rejected')
    if (failures.length > 0) {
      console.log(
        `Stake accounts final batch: ${failures.length}/${results.length} transactions failed`,
      )
    }
  }
}
