import { PublicKey } from '@solana/web3.js'
import { Command } from 'commander'
import {
  configureConfigureBond,
  manageConfigureBond,
  toBN,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'
import {
  Wallet as WalletInterface,
  parsePubkey,
} from '@marinade.finance/web3js-1x'
import BN from 'bn.js'

export function installConfigureBond(program: Command) {
  configureConfigureBond(program)
    .option(
      '--config <pubkey>',
      'The config account that the bond account is created under ' +
        '(optional; to derive bond address from vote account address) ' +
        `(default: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
      parsePubkey,
    )
    .option(
      '--cpmpe <number>',
      'Cost per mille per epoch, in lamports. The maximum amount of lamports the validator desires to pay for each 1000 delegated SOLs per epoch.',
      value => toBN(value),
    )
    .option(
      '--max-stake-wanted <number>',
      'The maximum stake amount, in lamports, that the validator wants to be delegated to them.',
      value => toBN(value),
    )
    .action(
      async (
        address: Promise<PublicKey>,
        {
          config,
          voteAccount,
          authority,
          withToken,
          bondAuthority,
          cpmpe,
          maxStakeWanted,
          computeUnitLimit,
        }: {
          config?: Promise<PublicKey>
          voteAccount?: Promise<PublicKey>
          authority?: Promise<WalletInterface | PublicKey>
          withToken: boolean
          bondAuthority?: Promise<PublicKey>
          cpmpe?: BN
          maxStakeWanted?: BN
          computeUnitLimit?: number
        },
      ) => {
        await manageConfigureBond({
          address: await address,
          config: (await config) ?? MARINADE_CONFIG_ADDRESS,
          voteAccount: await voteAccount,
          authority: await authority,
          withToken,
          newBondAuthority: await bondAuthority,
          cpmpe,
          maxStakeWanted,
          computeUnitLimit,
        })
      },
    )
}
