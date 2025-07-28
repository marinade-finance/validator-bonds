import { parsePubkey } from '@marinade.finance/cli-common'
import { PublicKey } from '@solana/web3.js'
import { Command } from 'commander'
import {
  configureMintBond,
  manageMintBond,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'

export function installMintBond(program: Command) {
  configureMintBond(program)
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
          rentPayer,
          computeUnitLimit,
        }: {
          config?: Promise<PublicKey>
          voteAccount?: Promise<PublicKey>
          rentPayer?: Promise<WalletInterface | PublicKey>
          computeUnitLimit: number
        },
      ) => {
        await manageMintBond({
          address: await address,
          config: (await config) ?? MARINADE_CONFIG_ADDRESS,
          voteAccount: await voteAccount,
          rentPayer: await rentPayer,
          computeUnitLimit,
        })
      },
    )
}
