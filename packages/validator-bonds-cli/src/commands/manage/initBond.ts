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
      parsePubkey,
    )
    .option(
      '--cpmpe <number>',
      'New value of cost per mille per epoch, in lamports. The maximum amount of lamports the validator desires to pay for each 1000 delegated SOLs per epoch.',
      value => toBN(value),
    )
    .option(
      '--max-stake-wanted <number>',
      'The maximum stake amount, in lamports, that the validator wants to be delegated to them (default: not-set).',
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
      async ({
        config,
        voteAccount,
        validatorIdentity,
        bondAuthority,
        rentPayer,
        cpmpe = new BN(0),
        maxStakeWanted = new BN(0),
        inflationCommission,
        mevCommission,
        blockCommission,
        uniformCommission,
        computeUnitLimit,
      }: {
        config?: Promise<PublicKey>
        voteAccount: Promise<PublicKey>
        validatorIdentity?: Promise<WalletInterface | PublicKey>
        bondAuthority: Promise<PublicKey>
        rentPayer?: Promise<WalletInterface | PublicKey>
        cpmpe: BN
        maxStakeWanted: BN
        inflationCommission?: BN | null
        mevCommission?: BN | null
        blockCommission?: BN | null
        uniformCommission?: BN | null
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
          inflationBps: inflationCommission,
          mevBps: mevCommission,
          blockBps: blockCommission,
          uniformBps: uniformCommission,
          computeUnitLimit,
        })
      },
    )
}
