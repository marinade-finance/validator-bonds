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
import BN from 'bn.js'

import type { Wallet as WalletInterface } from '@marinade.finance/web3js-1x'
import type { PublicKey } from '@solana/web3.js'
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
      '--rent-payer <keypair_or_ledger_or_pubkey>',
      'Rent payer for the commission configuration account creation. The commission configuration data is stored in a separate on-chain PDA account. ' +
        'This is optional when commission configuration account has not been created yet. ',
      parseWalletOrPubkeyOption,
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
    .option(
      '--inflation-commission <number>',
      'Inflation commission (voting commission) (bps). The validator re-declares the on-chain Inflation commission used by Marinade SAM/Bidding ' +
        'to calculate delegated SOL and bond claims. (default: not-set)',
      value => new BN(value),
    )
    .option(
      '--mev-commission <number>',
      'MEV commission (bps). The validator re-declares the on-chain MEV commission used by Marinade SAM/Bidding ' +
        'to calculate delegated SOL and bond claims. (default: not-set)',
      value => new BN(value),
    )
    .option(
      '--block-commission <number>',
      'Block rewards commission (bps). The validator may set-up on top of MEV and inflation commissions the commission for block rewards in bps. ' +
        "This way part of block rewards is shared with stakers through Bonds' claims. The more is shared the more is taken into account to calculate " +
        'delegated SOL and bond claims. (default: not-set)',
      value => new BN(value),
    )
    .option(
      '--uniform-commission <number>',
      'Uniform commission (bps). The validator may define unified commission that is used by Marinade SAM/Bidding ' +
        'calculations instead of setting individual commissions. (default: not-set)',
      value => new BN(value),
    )
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
          uniformCommission,
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
          uniformCommission?: BN | null
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
          uniformBps: uniformCommission,
          computeUnitLimit,
          rentPayer: await rentPayer,
          isPrintBanner: true,
        })
      },
    )
}
