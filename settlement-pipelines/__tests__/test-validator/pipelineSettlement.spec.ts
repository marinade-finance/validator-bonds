import {
  createTempFileKeypair,
  createUserAndFund,
} from '@marinade.finance/web3js-common'
import { sleep } from '@marinade.finance/ts-common'
import { shellMatchers } from '@marinade.finance/jest-utils'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  bondAddress,
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
  })

  afterAll(async () => {
    await bondAuthorityCleanup()
    await operatorAuthorityCleanup()
  })

  it('pipeline settlement', async () => {
    const epoch = 601
    const testJsonPath = path.join(
      __dirname,
      '..',
      'data',
      epoch + '_settlement-merkle-tree.json'
    )
    expect(fs.existsSync(testJsonPath)).toBeTruthy()
    const fileBuffer = fs.readFileSync(testJsonPath)
    const loadedJson = JSON.parse(fileBuffer.toString())

    const { configAccount } = await executeInitConfigInstruction({
      program,
      provider,
      operatorAuthority: operatorAuthorityKeypair,
      epochsToClaimSettlement: 0,
      withdrawLockupEpochs: 0,
    })

    const testData: {
      voteAccount: PublicKey
      bondAccount: PublicKey
      bondAuthority: Keypair
    }[] = []
    const settlementAddresses: PublicKey[] = []
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
        epoch,
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

    const randomMerkleTree =
      loadedJson.merkle_trees[
        Math.floor(Math.random() * loadedJson.merkle_trees.length)
      ]
    await executeInitSettlement({
      program,
      provider,
      configAccount,
      voteAccount: new PublicKey(randomMerkleTree.vote_account),
      operatorAuthority: operatorAuthorityKeypair,
      currentEpoch: epoch,
      merkleRoot: randomMerkleTree.merkle_root,
      maxMerkleNodes: randomMerkleTree.max_merkle_nodes,
      maxTotalClaim: randomMerkleTree.max_total_claim,
    })

    const feePayer = await createUserAndFund({
      provider,
      lamports: LAMPORTS_PER_SOL * 10_000,
    })
    const feePayerBase64 =
      '[' + (feePayer as Keypair).secretKey.toString() + ']'

    // TODO: remove this when using transaction executor in the CLI
    await sleep(12_000)

    const executionResultRegex = RegExp(
      settlementAddresses.length - 1 + ' executed successfully'
    )
    await (
      expect([
        'cargo',
        [
          'run',
          '--bin',
          'settlement',
          '--',
          '--operator-authority',
          operatorAuthorityPath,
          '--config',
          configAccount.toBase58(),
          '--rpc-url',
          provider.connection.rpcEndpoint,
          '-i',
          testJsonPath,
          '--fee-payer',
          feePayerBase64,
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      stderr: executionResultRegex,
    })

    const settlementsData = await getMultipleSettlements({
      program,
      addresses: settlementAddresses,
    })
    expect(settlementsData.length).toBe(settlementAddresses.length)
    expect(settlementsData.filter(s => s.account !== null).length).toEqual(
      settlementAddresses.length
    )

    await (
      expect([
        'cargo',
        [
          'run',
          '--bin',
          'settlement',
          '--',
          '--operator-authority',
          operatorAuthorityPath,
          '--config',
          configAccount.toBase58(),
          '--rpc-url',
          provider.connection.rpcEndpoint,
          '-i',
          testJsonPath,
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      stderr: /No InitSettlement/,
    })
  })
})
