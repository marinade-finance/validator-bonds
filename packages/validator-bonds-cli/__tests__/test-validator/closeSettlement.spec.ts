import {
  createTempFileKeypair,
  waitForNextEpoch,
} from '@marinade.finance/web3js-common'
import { shellMatchers } from '@marinade.finance/jest-utils'
import { Keypair, PublicKey } from '@solana/web3.js'
import { ValidatorBondsProgram } from '@marinade.finance/validator-bonds-sdk'
import {
  executeInitBondInstruction,
  executeInitConfigInstruction,
  executeInitSettlement,
} from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testTransactions'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/test-validator/testValidator'
import { createVoteAccount } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/staking'
import { AnchorExtendedProvider } from '@marinade.finance/anchor-common'

describe('Close settlement using CLI', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram
  let configAccount: PublicKey
  let voteAccount: PublicKey
  let validatorIdentityKeypair: Keypair
  let validatorIdentityCleanup: () => Promise<void>
  let operatorAuthority: Keypair

  beforeAll(async () => {
    shellMatchers()
    ;({ provider, program } = await initTest())
  })

  beforeEach(async () => {
    ;({ keypair: validatorIdentityKeypair, cleanup: validatorIdentityCleanup } =
      await createTempFileKeypair())
    ;({ configAccount, operatorAuthority } = await executeInitConfigInstruction(
      {
        program,
        provider,
        epochsToClaimSettlement: 0,
      },
    ))
    expect(
      await provider.connection.getAccountInfo(configAccount),
    ).not.toBeNull()
    ;({ voteAccount } = await createVoteAccount({
      provider,
      validatorIdentity: validatorIdentityKeypair,
    }))
    await executeInitBondInstruction({
      program,
      provider,
      configAccount,
      voteAccount,
    })
  })

  afterEach(async () => {
    await validatorIdentityCleanup()
  })

  it('close settlement', async () => {
    const rentCollector = Keypair.generate()
    const expirationEpoch = 0
    const { settlementAccount } = await executeInitSettlement({
      configAccount,
      program,
      provider,
      voteAccount,
      operatorAuthority,
      rentCollector: rentCollector.publicKey,
      currentEpoch: expirationEpoch,
    })

    expect(
      await provider.connection.getAccountInfo(settlementAccount),
    ).not.toBeNull()
    const currentEpoch = (await program.provider.connection.getEpochInfo())
      .epoch
    if (expirationEpoch <= currentEpoch) {
      await waitForNextEpoch(provider.connection, 15)
    }

    await (
      expect([
        'pnpm',
        [
          'cli',
          '-u',
          provider.connection.rpcEndpoint,
          'close-settlement',
          settlementAccount.toBase58(),
          '--confirmation-finality',
          'confirmed',
          '--verbose',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      stdout: /successfully closed/,
    })

    const settlementData =
      await provider.connection.getAccountInfo(settlementAccount)
    expect(settlementData).toBeNull()
  })
})
