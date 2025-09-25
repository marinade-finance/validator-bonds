import { extendJestWithShellMatchers } from '@marinade.finance/jest-shell-matcher'
import YAML from 'yaml'
import {
  ValidatorBondsProgram,
  MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
  bondMintAddress,
} from '@marinade.finance/validator-bonds-sdk'
import { Keypair } from '@solana/web3.js'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testValidator'
import { executeInitBondInstruction } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testTransactions'
import { createVoteAccount } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/staking'
import { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import { loadTestingVoteAccount } from '@marinade.finance/validator-bonds-cli-core'

beforeAll(() => {
  extendJestWithShellMatchers()
})

describe('Show command using CLI (institutional)', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram

  beforeAll(async () => {
    extendJestWithShellMatchers()
    ;({ provider, program } = await initTest('processed'))
  })

  it('show bond (institutional)', async () => {
    expect(
      await provider.connection.getAccountInfo(
        MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
      ),
    ).not.toBeNull()
    const { voteAccount, validatorIdentity } = await createVoteAccount({
      provider,
    })
    const bondAuthority = Keypair.generate()
    const { bondAccount } = await executeInitBondInstruction({
      program,
      provider,
      configAccount: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
      bondAuthority,
      voteAccount,
      validatorIdentity,
    })
    const voteAccountShow = await loadTestingVoteAccount(
      provider.connection,
      voteAccount,
    )
    const expectedDataNoFunding = {
      programId: program.programId,
      publicKey: bondAccount.toBase58(),
      account: {
        config: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS.toBase58(),
        voteAccount: voteAccount.toBase58(),
        authority: bondAuthority.publicKey.toBase58(),
      },
    }
    const expectedDataFundingSingleItem = {
      ...expectedDataNoFunding,
      voteAccount: voteAccountShow,
      amountOwned: '0 SOL',
      amountActive: '0 SOL',
      numberActiveStakeAccounts: 0,
      amountAtSettlements: '0 SOL',
      numberSettlementStakeAccounts: 0,
      amountToWithdraw: '0 SOL',
      withdrawRequest: '<NOT EXISTING>',
      bondMint: bondMintAddress(
        bondAccount,
        voteAccountShow.nodePubkey!,
        program.programId,
      )[0].toBase58(),
    }

    await (
      expect([
        'pnpm',
        [
          '--silent',
          'cli:institutional',
          '-u',
          provider.connection.rpcEndpoint,
          'show-bond',
          bondAccount.toBase58(),
          '--with-funding',
          '-f',
          'yaml',
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ]) as any
    ).toHaveMatchingSpawnOutput({
      code: 0,
      signal: '',
      stdout: YAML.stringify(expectedDataFundingSingleItem),
    })
  })
})
