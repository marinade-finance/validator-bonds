import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { getAnchorValidatorInfo } from '@marinade.finance/anchor-common'
import {
  bondsWithdrawerAuthority,
  getStakeAccount,
} from '@marinade.finance/validator-bonds-sdk'
import {
  createSettlementFundedDelegatedStake,
  createSettlementFundedInitializedStake,
  createVoteAccountWithIdentity,
} from '@marinade.finance/validator-bonds-sdk/__tests__/utils/staking'
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
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js'

import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { ValidatorBondsProgram } from '@marinade.finance/validator-bonds-sdk'
import type { PublicKey } from '@solana/web3.js'

jest.setTimeout(600_000)

async function cargoRun(
  args: string[],
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('cargo', ['run', '--bin', ...args])
    let stderr = ''
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })
    child.stdout.resume()
    child.on('error', reject)
    child.on('close', code => resolve({ code, stderr }))
  })
}

// stake program 0x10 (EpochRewardsActive) rejects stake changes while an epoch pays out rewards
function onlyEpochRewardsActiveFailures(stderr: string): boolean {
  const failures = stderr.match(/^.*\(source: transaction_execution\)/gm) ?? []
  return (
    failures.length > 0 &&
    failures.every(f =>
      /: failed(?: in \S+)?: .*custom program error: 0x10\b/.test(f),
    )
  )
}

describe('Cargo CLI: close-settlement', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let operatorAuthorityPath: string
  let operatorAuthorityCleanup: () => Promise<void>
  let configAccount: PublicKey
  let workDir: string

  beforeAll(async () => {
    ;({ provider, program } = initTest('processed'))
    let operatorAuthorityKeypair: Keypair
    ;({
      path: operatorAuthorityPath,
      keypair: operatorAuthorityKeypair,
      cleanup: operatorAuthorityCleanup,
    } = await createTempFileKeypair())
    ;({ configAccount } = await executeInitConfigInstruction({
      program,
      provider,
      operatorAuthority: operatorAuthorityKeypair,
      epochsToClaimSettlement: 1,
      withdrawLockupEpochs: 0,
    }))
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'close-settlement-test-'))
  })

  afterAll(async () => {
    await operatorAuthorityCleanup()
    fs.rmSync(workDir, { recursive: true, force: true })
  })

  it('closes expired settlements, then resets the delegated stake and withdraws the initialized one', async () => {
    const operatorAuthority = Keypair.fromSecretKey(
      new Uint8Array(
        JSON.parse(fs.readFileSync(operatorAuthorityPath, 'utf-8')) as number[],
      ),
    )
    const { validatorIdentity } = await getAnchorValidatorInfo(
      provider.connection,
    )
    const { voteAccount } = await createVoteAccountWithIdentity(
      provider,
      validatorIdentity,
    )
    const { bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
      validatorIdentity,
    })
    const currentEpoch = (await provider.connection.getEpochInfo()).epoch
    const settlements = [
      await executeInitSettlement({
        program,
        provider,
        configAccount,
        voteAccount,
        operatorAuthority,
        currentEpoch,
      }),
      await executeInitSettlement({
        program,
        provider,
        configAccount,
        voteAccount,
        operatorAuthority,
        currentEpoch,
      }),
    ]
    const [delegatedSettlement, initializedSettlement] = settlements
    const delegatedStake = await createSettlementFundedDelegatedStake({
      program,
      provider,
      configAccount,
      settlementAccount: delegatedSettlement!.settlementAccount,
      voteAccount,
      lamports: 2 * LAMPORTS_PER_SOL,
    })
    const initializedLamports = 2 * LAMPORTS_PER_SOL
    const initializedStake = await createSettlementFundedInitializedStake({
      program,
      provider,
      configAccount,
      settlementAccount: initializedSettlement!.settlementAccount,
      lamports: initializedLamports,
    })

    const listedSettlementsPath = path.join(workDir, 'listed-settlements.json')
    fs.writeFileSync(
      listedSettlementsPath,
      JSON.stringify(
        settlements.map(s => ({
          config_address: configAccount.toBase58(),
          bond_address: bondAccount.toBase58(),
          vote_account_address: voteAccount.toBase58(),
          settlement_address: s.settlementAccount.toBase58(),
          epoch: currentEpoch,
          merkle_root: Array.from(s.merkleRoot),
          claims_count: s.maxMerkleNodes.toNumber(),
          claims_lamports: s.maxTotalClaim.toNumber(),
        })),
      ),
    )
    const feePayer = (await createUserAndFund({
      provider,
      lamports: 10 * LAMPORTS_PER_SOL,
    })) as Keypair
    const marinadeWallet = Keypair.generate().publicKey

    while (
      (await provider.connection.getEpochInfo()).epoch <=
      currentEpoch + 1
    ) {
      await waitForNextEpoch(provider.connection, 15)
    }

    const args = [
      'close-settlement',
      '--',
      '--operator-authority',
      operatorAuthorityPath,
      '--config',
      configAccount.toBase58(),
      '--rpc-url',
      provider.connection.rpcEndpoint,
      '--fee-payer',
      '[' + feePayer.secretKey.toString() + ']',
      '--marinade-wallet',
      marinadeWallet.toBase58(),
      '--listed-settlements',
      listedSettlementsPath,
    ]
    let result = await cargoRun(args)
    for (
      let attempt = 0;
      attempt < 3 && onlyEpochRewardsActiveFailures(result.stderr);
      attempt++
    ) {
      result = await cargoRun(args)
    }
    expect({ code: result.code, stderr: result.stderr }).toEqual({
      code: 0,
      stderr: expect.stringMatching(
        /CloseSettlements: txes 1\/ixes 2 executed successfully(.|\n|\r)*Reset\/WithdrawStakeAccounts: txes 1\/ixes 2 executed successfully/,
      ) as string,
    })

    for (const s of settlements) {
      expect(
        await provider.connection.getAccountInfo(s.settlementAccount),
      ).toBeNull()
      expect(
        await provider.connection.getAccountInfo(s.settlementClaimsAccount),
      ).toBeNull()
    }
    const [bondsAuth] = bondsWithdrawerAuthority(
      configAccount,
      program.programId,
    )
    const resetStake = await getStakeAccount(provider, delegatedStake)
    expect(resetStake.staker).toEqual(bondsAuth)
    expect(resetStake.withdrawer).toEqual(bondsAuth)
    expect(
      await provider.connection.getAccountInfo(initializedStake),
    ).toBeNull()
    expect(await provider.connection.getBalance(marinadeWallet)).toEqual(
      initializedLamports,
    )
  })
})
