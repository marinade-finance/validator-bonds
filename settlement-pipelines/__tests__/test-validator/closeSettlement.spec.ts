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

import { cargoRun, onlyEpochRewardsActiveFailures } from './utils'

import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { ValidatorBondsProgram } from '@marinade.finance/validator-bonds-sdk'
import type { PublicKey } from '@solana/web3.js'

jest.setTimeout(600_000)

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
    expect(result.stderr).toMatch(
      /CloseSettlements: txes 1\/ixes 2 executed successfully/,
    )
    // the run starts right after the epoch boundary, inside the rewards payout that blocks stake changes
    for (let retry = 0; result.code === 100 && retry < 3; retry++) {
      expect(onlyEpochRewardsActiveFailures(result.stderr)).toBe(true)
      result = await cargoRun(args)
    }
    expect(result.code).toEqual(0)
    expect(result.stderr).toMatch(
      /Reset\/WithdrawStakeAccounts: txes 1\/ixes 2 executed successfully/,
    )

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
