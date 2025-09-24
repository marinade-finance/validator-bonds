import {
  manageInitBond,
  toBN,
} from '@marinade.finance/validator-bonds-cli-core'
import { configureInitBond } from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'
import { parsePubkey } from '@marinade.finance/web3js-1x'
import BN from 'bn.js'

import type { Wallet as WalletInterface } from '@marinade.finance/web3js-1x'
import type { PublicKey } from '@solana/web3.js'
import type { Command } from 'commander'

export function installInitBond(program: Command) {
  configureInitBond(program)
    .option(
      '--config <pubkey>',
      'The config account that the bond is created under. ' +
        `(default: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
      parsePubkey
    )
    .option(
      '--cpmpe <number>',
      'New value of cost per mille per epoch, in lamports. The maximum amount of lamports the validator desires to pay for each 1000 delegated SOLs per epoch.',
      value => toBN(value)
    )
    .option(
      '--max-stake-wanted <number>',
      'The maximum stake amount, in lamports, that the validator wants to be delegated to them (default: not-set).',
      value => toBN(value)
    )
    .action(
      async ({
        config,
        voteAccount,
        validatorIdentity,
        bondAuthority,
        rentPayer,
        cpmpe = new BN(0),
        maxStakeWanted = new BN(0),
        computeUnitLimit,
      }: {
        config?: Promise<PublicKey>
        voteAccount: Promise<PublicKey>
        validatorIdentity?: Promise<WalletInterface | PublicKey>
        bondAuthority: Promise<PublicKey>
        rentPayer?: Promise<WalletInterface | PublicKey>
        cpmpe: BN
        maxStakeWanted: BN
        computeUnitLimit: number
      }) => {
        await manageInitBond({
          config: (await config) ?? MARINADE_CONFIG_ADDRESS,
          voteAccount: await voteAccount,
          validatorIdentity: await validatorIdentity,
          bondAuthority: await bondAuthority,
          rentPayer: await rentPayer,
          cpmpe,
          maxStakeWanted,
          computeUnitLimit,
        })
      }
    )
}
