import {
  configureConfigureBond,
  manageConfigureBond,
  toBN,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'
import {
  parsePubkey,
  parseWalletOrPubkeyOption,
} from '@marinade.finance/web3js-1x'

import {
  blockCommissionOption,
  inflationCommissionOption,
  mevCommissionOption,
} from './initBond'

import type { Wallet as WalletInterface } from '@marinade.finance/web3js-1x'
import type { PublicKey } from '@solana/web3.js'
import type BN from 'bn.js'
import type { Command } from 'commander'

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
      '--rent-payer <keypair-or-ledger-or-pubkey>',
      'Rent payer for the commission configuration account creation. The commission configuration data is stored in a separate on-chain PDA account. ' +
        'This is optional when commission configuration account has not been created yet. ',
      parseWalletOrPubkeyOption,
    )
    .option(
      '--cpmpe <number lamports>',
      'Cost per mille per epoch, in lamports. The maximum amount of lamports the validator desires to pay for each 1000 delegated SOLs per epoch.',
      value => toBN(value),
    )
    .option(
      '--max-stake-wanted <number lamports>',
      'The maximum stake amount, in lamports, that the validator wants to be delegated to them.',
      value => toBN(value),
    )
    .addOption(inflationCommissionOption())
    .addOption(mevCommissionOption())
    .addOption(blockCommissionOption())
    .action(
      async (
        address: Promise<PublicKey>,
        {
          config,
          authority,
          withToken,
          bondAuthority,
          cpmpe,
          maxStakeWanted,
          inflationCommission,
          mevCommission,
          blockCommission,
          computeUnitLimit,
          rentPayer,
        }: {
          config?: Promise<PublicKey>
          authority?: Promise<WalletInterface | PublicKey>
          withToken: boolean
          bondAuthority?: Promise<PublicKey>
          cpmpe?: BN
          maxStakeWanted?: BN
          inflationCommission?: BN | null
          mevCommission?: BN | null
          blockCommission?: BN | null
          computeUnitLimit?: number
          rentPayer?: Promise<WalletInterface | PublicKey>
        },
      ) => {
        await manageConfigureBond({
          address: await address,
          config: (await config) ?? MARINADE_CONFIG_ADDRESS,
          authority: await authority,
          withToken,
          newBondAuthority: await bondAuthority,
          cpmpe,
          maxStakeWanted,
          inflationBps: inflationCommission,
          mevBps: mevCommission,
          blockBps: blockCommission,
          uniformBps: undefined,
          computeUnitLimit,
          rentPayer: await rentPayer,
        })
      },
    )
}
