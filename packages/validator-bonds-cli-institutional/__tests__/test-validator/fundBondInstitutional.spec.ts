import { waitForStakeAccountActivation } from '@marinade.finance/anchor-common'
import { extendJestWithShellMatchers } from '@marinade.finance/jest-shell-matcher'
import {
  getStakeAccount,
  bondsWithdrawerAuthority,
  MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
} from '@marinade.finance/validator-bonds-sdk'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testValidator'
import {
  createVoteAccount,
  delegatedStakeAccount,
} from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/staking'
import { executeInitBondInstruction } from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/testTransactions'
import { createTempFileKeypair } from '@marinade.finance/web3js-1x'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'

import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { ValidatorBondsProgram } from '@marinade.finance/validator-bonds-sdk'
import type { Keypair, PublicKey } from '@solana/web3.js'

describe('Fund bond account using CLI (institutional)', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let bondAccount: PublicKey
  let voteAccount: PublicKey
  let stakeWithdrawerPath: string
  let stakeWithdrawerKeypair: Keypair
  let stakeWithdrawerCleanup: () => Promise<void>

  beforeAll(() => {
    extendJestWithShellMatchers()
    ;({ provider, program } = initTest())
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
      program.programId
    )

    const { stakeAccount: stakeAccount1 } = await delegatedStakeAccount({
      provider,
      lamports: LAMPORTS_PER_SOL * 2,
      voteAccountToDelegate: voteAccount,
      withdrawer: stakeWithdrawerKeypair,
    })

    const stakeAccountData1Before = await getStakeAccount(
      provider,
      stakeAccount1
    )
    expect(stakeAccountData1Before.withdrawer).toEqual(
      stakeWithdrawerKeypair.publicKey
    )

    console.debug(
      `Waiting for stake account ${stakeAccount1.toBase58()} to be fully activated`
    )
    await waitForStakeAccountActivation({
      stakeAccount: stakeAccount1,
      connection: provider.connection,
    })
    await expect([
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
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      // stderr: '',
      stdout: /successfully funded/,
    })

    const stakeAccountData1 = await getStakeAccount(provider, stakeAccount1)
    expect(stakeAccountData1.staker).toEqual(bondWithdrawer)
    expect(stakeAccountData1.withdrawer).toEqual(bondWithdrawer)
  })
})
