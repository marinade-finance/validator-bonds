import assert from 'assert'

import { extendJestWithShellMatchers } from '@marinade.finance/jest-shell-matcher'
import { loadTestingVoteAccount } from '@marinade.finance/validator-bonds-cli-core'
import {
  MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
  bondMintAddress,
} from '@marinade.finance/validator-bonds-sdk'
import { initTest } from '@marinade.finance/validator-bonds-sdk/__tests__/utils/testValidator'
import { createVoteAccount } from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/staking'
import { executeInitBondInstruction } from '@marinade.finance/validator-bonds-sdk/dist/__tests__/utils/testTransactions'
import { Keypair, PublicKey } from '@solana/web3.js'
import YAML from 'yaml'

import type { AnchorExtendedProvider } from '@marinade.finance/anchor-common'
import type { ValidatorBondsProgram } from '@marinade.finance/validator-bonds-sdk'

beforeAll(() => {
  extendJestWithShellMatchers()
})

describe('Show command using CLI (institutional)', () => {
  let provider: AnchorExtendedProvider
  let program: ValidatorBondsProgram

  beforeAll(() => {
    extendJestWithShellMatchers()
    ;({ provider, program } = initTest('processed'))
  })

  it('show bond (institutional)', async () => {
    assert(
      (await provider.connection.getAccountInfo(
        MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
      )) !== null,
    )
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
      configs: [],
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
        voteAccountShow.nodePubkey || PublicKey.default,
        program.programId,
      )[0].toBase58(),
    }

    await expect([
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
    ]).toHaveMatchingSpawnOutput({
      code: 0,
      signal: '',
      stdout: YAML.stringify(expectedDataFundingSingleItem),
    })
  })
})
