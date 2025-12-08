import {
  manageInitBond,
  toBN,
} from '@marinade.finance/validator-bonds-cli-core'
import { configureInitBond } from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'
import { parsePubkey } from '@marinade.finance/web3js-1x'
import BN from 'bn.js'
import { createOption, type Command, type Option } from 'commander'

import type { Wallet as WalletInterface } from '@marinade.finance/web3js-1x'
import type { PublicKey } from '@solana/web3.js'

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
      '--max-stake-wanted <number lamports>',
      'The maximum stake amount, in lamports, that the validator wants to be delegated to them (default: not-set).',
      value => toBN(value),
    )
    .addOption(inflationCommissionOption())
    .addOption(mevCommissionOption())
    .addOption(blockCommissionOption())
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
          uniformBps: undefined,
          computeUnitLimit,
        })
      },
    )
}

const COMMISSION_OPTION_COMMON_TEXT =
  'to calculate its position in the auction and the rewards shared with stakers through bond claims. ' +
  'The value can be negative (meaning the validator keeps no rewards and may even share an additional portion). ' +
  '(default: not set)'

export function inflationCommissionOption(): Option {
  return createOption(
    '--inflation-commission <number bps>',
    'Set the inflation/voting commission in basis points (10,000 bps = 100%). The validator re-declares the on-chain inflation commission used by Marinade SAM ' +
      COMMISSION_OPTION_COMMON_TEXT,
  ).argParser(value => new BN(value))
}

export function mevCommissionOption(): Option {
  return createOption(
    '--mev-commission <number bps>',
    'Set the MEV/Jito commission in basis points (10,000 bps = 100%). The validator re-declares the on-chain MEV commission used by Marinade SAM ' +
      COMMISSION_OPTION_COMMON_TEXT,
  ).argParser(value => new BN(value))
}

export function blockCommissionOption(): Option {
  return createOption(
    '--block-commission <number bps>',
    'Set the block rewards commission in basis points (10,000 bps = 100%). The validator declares the rewards commission to be used by Marinade SAM ' +
      COMMISSION_OPTION_COMMON_TEXT,
  ).argParser(value => new BN(value))
}
