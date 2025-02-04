import { parsePubkey } from '@marinade.finance/cli-common'
import { PublicKey } from '@solana/web3.js'
import { Command } from 'commander'
import {
  configureConfigureBond,
  manageConfigureBond,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
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
        }: {
          config?: Promise<PublicKey>
          voteAccount?: Promise<PublicKey>
          authority?: Promise<WalletInterface | PublicKey>
          withToken: boolean
          bondAuthority?: Promise<PublicKey>
          cpmpe?: BN
          maxStakeWanted?: BN
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
        })
      },
    )
}
