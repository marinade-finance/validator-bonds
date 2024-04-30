import {
  createTempFileKeypair,
  createUserAndFund,
} from '@marinade.finance/web3js-common'
import { shellMatchers } from '@marinade.finance/jest-utils'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  bondAddress,
  bondsWithdrawerAuthority,
  findConfigStakeAccounts,
  findSettlements,
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
import { createDelegatedStakeAccount } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/staking'
import BN from 'bn.js'
import { waitForNextEpoch } from '@marinade.finance/web3js-common'

jest.setTimeout(360_000)

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
  let merkleTreeCollectionPath: string
  let settlementCollectionPath: string
  let currentEpoch: number

  beforeAll(async () => {
    shellMatchers()
    ;({ provider, program } = await initTest())
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
    merkleTreeCollectionPath = path.join(
      __dirname,
      '..',
      'data',
      fileEpoch + '_settlement-merkle-tree.json'
    )
    expect(fs.existsSync(merkleTreeCollectionPath)).toBeTruthy()
    settlementCollectionPath = path.join(
      __dirname,
      '..',
      'data',
      fileEpoch + '_settlements.json'
    )
    expect(fs.existsSync(merkleTreeCollectionPath)).toBeTruthy()
    const fileBuffer = fs.readFileSync(merkleTreeCollectionPath)
    loadedJson = JSON.parse(fileBuffer.toString())
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
      operatorAuthority: operatorAuthorityKeypair,
      epochsToClaimSettlement: 7,
      slotsToStartSettlementClaiming: 5,
      withdrawLockupEpochs: 0,
    }))

    currentEpoch = (await program.provider.connection.getEpochInfo()).epoch

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
        currentEpoch,
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

  it('pipeline settlement', async () => {
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
    await waitForNextEpoch(provider.connection, 15)

    const executionResultRegex = RegExp(
      settlementAddresses.length -
        1 +
        ' executed successfully(.|\n|\r)*' +
        'Stake accounts management instructions 0(.|\n|\r)*FundSettlement instructions 2'
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
      code: 1,
      stderr: executionResultRegex,
      stdout: /Cannot find stake account to fund settlement account/,
    })

    const settlementsData = await getMultipleSettlements({
      program,
      addresses: settlementAddresses,
    })
    expect(settlementsData.length).toEqual(settlementAddresses.length)
    // TODO: fixing the assertion in claiming pipeline test
    // expect(settlementsData.filter(s => s.account !== null).length).toEqual(
    //   settlementAddresses.length
    // )

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
      code: 1,
      stderr:
        /InitSettlement instructions 0(.|\n|\r)*already funded(.|\n|\r)*Stake accounts management instructions 0(.|\n|\r)*FundSettlement instructions 0/,
      stdout: /Cannot find stake account to fund settlement account/,
    })

    const createdSettlements = await findSettlements({
      program,
      epoch: currentEpoch,
    })
    expect(createdSettlements.length).toEqual(settlementAddresses.length)

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
        /InitSettlement instructions 0(.|\n|\r)*Stake accounts management instructions [2-9](.|\n|\r)*FundSettlement instructions 9/,
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
        /InitSettlement instructions 0(.|\n|\r)*already funded(.|\n|\r)*Stake accounts management instructions 0(.|\n|\r)*FundSettlement instructions 0/,
      stdout: "",
    })
  })
})
