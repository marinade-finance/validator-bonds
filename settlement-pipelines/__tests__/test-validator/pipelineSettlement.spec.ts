import {
  createTempFileKeypair,
  createUserAndFund,
  waitForNextEpoch,
} from '@marinade.finance/web3js-common'
import { sleep } from '@marinade.finance/ts-common'
import { shellMatchers } from '@marinade.finance/jest-utils'
import {
  Authorized,
  Keypair,
  LAMPORTS_PER_SOL,
  Lockup,
  PublicKey,
  StakeProgram,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  bondAddress,
  bondsWithdrawerAuthority,
  findConfigStakeAccounts,
  findSettlements,
  findStakeAccountNoDataInfos,
  getMultipleSettlements,
  settlementAddress,
} from '@marinade.finance/validator-bonds-sdk'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testTransactions'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/test-validator/testValidator'
import { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import fs from 'fs'
import path from 'path'
import {
  createDelegatedStakeAccount,
  getRentExemptStake,
} from '@marinade.finance/validator-bonds-sdk/__tests__/utils/staking'
import BN from 'bn.js'
import assert from 'assert'

const JEST_TIMEOUT_MS = 3000_000
jest.setTimeout(JEST_TIMEOUT_MS)

const VOTE_ACCOUNT_IDENTITY = Keypair.fromSecretKey(
  new Uint8Array([
    46, 122, 115, 233, 205, 38, 160, 89, 108, 12, 253, 183, 136, 97, 7, 157, 83,
    175, 62, 146, 129, 33, 153, 77, 189, 254, 166, 210, 202, 33, 248, 158, 49,
    85, 171, 80, 177, 237, 201, 127, 92, 110, 192, 28, 134, 162, 226, 7, 226,
    156, 183, 23, 80, 139, 58, 54, 160, 186, 75, 85, 77, 212, 82, 182,
  ])
)
// const VOTE_ACCOUNT_WITHDRAWER = Keypair.fromSecretKey(
//   new Uint8Array([
//     36, 140, 47, 220, 125, 52, 60, 54, 208, 146, 200, 76, 12, 1, 138, 158, 105,
//     44, 172, 88, 252, 167, 76, 55, 187, 56, 224, 117, 69, 233, 148, 186, 144, 3,
//     69, 190, 84, 246, 127, 228, 121, 88, 60, 225, 159, 165, 142, 161, 106, 238,
//     14, 161, 165, 250, 245, 152, 35, 130, 125, 133, 168, 146, 126, 104,
//   ])
// )

// This test case runs really long as using data from epoch 601 and needs to setup
// all parts and create 10K settlements. Run this manually when needed
// FILE='settlement-pipelines/__tests__/test-validator/pipelineSettlement.spec.ts' pnpm test:validator
describe('Cargo CLI: Pipeline Settlement', () => {
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
  let settlementCollectionPath: string
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
    shellMatchers()
    ;({ provider, program } = await initTest('processed'))
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
    merkleTreesDir = path.join(__dirname, '..', 'data')
    merkleTreeCollectionPath = path.join(
      merkleTreesDir,
      fileEpoch + '_settlement-merkle-trees.json'
    )
    expect(fs.existsSync(merkleTreeCollectionPath)).toBeTruthy()
    settlementCollectionPath = path.join(
      merkleTreesDir,
      fileEpoch + '_settlements.json'
    )
    expect(fs.existsSync(merkleTreeCollectionPath)).toBeTruthy()
    const fileBuffer = fs.readFileSync(merkleTreeCollectionPath)
    loadedJson = JSON.parse(fileBuffer.toString())
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
      operatorAuthority: operatorAuthorityKeypair,
      epochsToClaimSettlement: 100_000,
      slotsToStartSettlementClaiming: 5,
      withdrawLockupEpochs: 0,
    }))

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
        program.programId
      )
      const [settlementAccount] = settlementAddress(
        bondAccount,
        merkleTree.merkle_root,
        beforeEpoch,
        program.programId
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
          })
        )
      }
    }
  })

  afterAll(async () => {
    await bondAuthorityCleanup()
    await operatorAuthorityCleanup()
  })

  it('init settlements', async () => {
    assert(previousTest === TestNames.None)
    await // build the rust before running the tests
    (
      expect([
        'cargo',
        ['build'],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
    })

    const randomMerkleTree =
      loadedJson.merkle_trees[
        Math.floor(Math.random() * loadedJson.merkle_trees.length)
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

    const executionResultRegex = RegExp(
      settlementAddresses.length -
        1 +
        ' executed successfully(.|\n|\r)*' +
        'Stake accounts management txes 0(.|\n|\r)*FundSettlements: txes 1'
    )
    await (
      expect([
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
          '-s',
          settlementCollectionPath,
          '--epoch',
          currentEpoch.toString(),
          '--fee-payer',
          feePayerBase64,
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 2,
      stderr: executionResultRegex,
      stdout: /Cannot find stake account to fund settlement/,
    })

    await waitForNextEpoch(provider.connection, 15)

    await (
      expect([
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
          '-s',
          settlementCollectionPath,
          '--epoch',
          currentEpoch.toString(),
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 2,
      stderr:
        /InitSettlement ... txes 0(.|\n|\r)*already funded(.|\n|\r)*Stake accounts management txes 0(.|\n|\r)*FundSettlements: txes 0/,
      stdout: /Cannot find stake account to fund settlement/,
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
      program.programId
    )
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

    const stdoutRegExp = RegExp(settlementAddresses.length + ' settlements')

    await (
      expect([
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
          '-s',
          settlementCollectionPath,
          '--epoch',
          currentEpoch.toString(),
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      stderr:
        /InitSettlement ... txes 0(.|\n|\r)*Stake accounts management txes 1(.|\n|\r)*FundSettlements:.*ixes 9 executed/,
      stdout: stdoutRegExp,
    })

    const allConfigStakeAccounts = await findConfigStakeAccounts({
      program,
      configAccount,
    })
    const fundedStakeAccounts = allConfigStakeAccounts.filter(
      s => !s.account.data.staker?.equals(withdrawerAuthority)
    )
    expect(fundedStakeAccounts.length).toEqual(settlementAddresses.length)

    await (
      expect([
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
          '-s',
          settlementCollectionPath,
          '--epoch',
          currentEpoch.toString(),
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      stderr:
        /InitSettlement ... txes 0(.|\n|\r)*already funded(.|\n|\r)*Stake accounts management txes 0(.|\n|\r)*FundSettlements: txes 0/,
      stdout: stdoutRegExp,
    })
    previousTest = TestNames.InitSettlement
  })

  it('list claimable epochs', async () => {
    assert(previousTest === TestNames.InitSettlement)
    const epochRegexp = new RegExp('[' + currentEpoch + ']')
    await (
      expect([
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
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
    expect(stakeAccounts.length).toBeGreaterThanOrEqual(stakeAccountsNumber)

    console.log(
      `Claiming settlements;  epoch: ${currentEpoch}, config: ${configAccount.toBase58()} at ${
        provider.connection.rpcEndpoint
      }`
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

    // expecting some error as we have not fully funded settlements
    // the number of executed instructions is not clear, as some fails
    await (
      expect([
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
          '-s',
          merkleTreeCollectionPath,
          settlementCollectionPath,
          '--epoch',
          currentEpoch.toString(),
          '--fee-payer',
          feePayerBase64,
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 2,
      stderr: /All stake accounts are locked for claiming/,
      stdout: /created 12[0-9][0-9][0-9] ClaimSettlement accounts/,
    })

    // still expecting some error as we have not fully funded settlements
    console.log('Rerunning when all is already claimed...')
    await (
      expect([
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
          '--settlement-json-files',
          merkleTreeCollectionPath,
          settlementCollectionPath,
          '--epoch',
          currentEpoch.toString(),
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 2,
      stdout:
        /created 0 ClaimSettlement accounts(.|\n|\r)*No stake account found with enough SOL/,
    })
    previousTest = TestNames.ClaimSettlement
  })
})

export async function chunkedCreateInitializedStakeAccounts({
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
  const lockedAccounts = Array.from(
    { length: 20 },
    () => Math.floor(Math.random() * combined.length) + 1
  )
  for (const { staker, withdrawer, keypair } of combined) {
    counter++
    let lockup: Lockup | undefined = undefined
    if (lockedAccounts.includes(counter)) {
      // some accounts will be locked
      lockup = new Lockup(0, Number.MAX_SAFE_INTEGER, PublicKey.default)
    }
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
      await Promise.all(futures)
      futures = []
    }
    if (counter % 5000 === 0) {
      console.log(`Stake accounts ${counter}/${combined.length} created`)
    }
  }
  console.log(
    `Waiting for counter stake accounts ${counter}/${combined.length} to be created`
  )
  if (futures.length > 0) {
    await Promise.all(futures)
  }
}
