import { createTempFileKeypair } from '@marinade.finance/web3js-1x'
import { extendJestWithShellMatchers } from '@marinade.finance/jest-shell-matcher'
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  getStakeAccount,
  bondsWithdrawerAuthority,
  MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
} from '@marinade.finance/validator-bonds-sdk'
import { executeInitBondInstruction } from '../../../validator-bonds-sdk/__tests__/utils/testTransactions'
import { initTest } from '../../../validator-bonds-sdk/__tests__/test-validator/testValidator'
import {
  createVoteAccount,
  delegatedStakeAccount,
} from '../../../validator-bonds-sdk/__tests__/utils/staking'
import {
  AnchorExtendedProvider,
  waitForStakeAccountActivation,
} from '@marinade.finance/anchor-common'

describe('Fund bond account using CLI (institutional)', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let bondAccount: PublicKey
  let voteAccount: PublicKey
  let stakeWithdrawerPath: string
  let stakeWithdrawerKeypair: Keypair
  let stakeWithdrawerCleanup: () => Promise<void>

  beforeAll(async () => {
    extendJestWithShellMatchers()
    ;({ provider, program } = await initTest())
  })

  beforeEach(async () => {
    ;({
      path: stakeWithdrawerPath,
      keypair: stakeWithdrawerKeypair,
      cleanup: stakeWithdrawerCleanup,
    } = await createTempFileKeypair())
    const { voteAccount: voteAccountAddress, validatorIdentity } =
      await createVoteAccount({ provider })
    voteAccount = voteAccountAddress
    ;({ bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
      voteAccount,
      validatorIdentity,
      cpmpe: 123,
    }))
  })

  afterEach(async () => {
    await stakeWithdrawerCleanup()
  })

  it('fund bond account (institutional)', async () => {
    const [bondWithdrawer] = bondsWithdrawerAuthority(
      MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
      program.programId,
    )

    const { stakeAccount: stakeAccount1 } = await delegatedStakeAccount({
      provider,
      lamports: LAMPORTS_PER_SOL * 2,
      voteAccountToDelegate: voteAccount,
      withdrawer: stakeWithdrawerKeypair,
    })

    const stakeAccountData1Before = await getStakeAccount(
      provider,
      stakeAccount1,
    )
    expect(stakeAccountData1Before.withdrawer).toEqual(
      stakeWithdrawerKeypair.publicKey,
    )

    console.debug(
      `Waiting for stake account ${stakeAccount1.toBase58()} to be fully activated`,
    )
    await waitForStakeAccountActivation({
      stakeAccount: stakeAccount1,
      connection: provider.connection,
    })
    await (
      expect([
        'pnpm',
        [
          'cli:institutional',
          '-u',
          provider.connection.rpcEndpoint,
          'fund-bond',
          bondAccount.toBase58(),
          '--stake-account',
          stakeAccount1.toBase58(),
          '--stake-authority',
          stakeWithdrawerPath,
          '--confirmation-finality',
          'confirmed',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully funded/,
    })

    const stakeAccountData1 = await getStakeAccount(provider, stakeAccount1)
    expect(stakeAccountData1.staker).toEqual(bondWithdrawer)
    expect(stakeAccountData1.withdrawer).toEqual(bondWithdrawer)
  })
})
