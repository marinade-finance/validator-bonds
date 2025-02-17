import { parsePubkey } from '@marinade.finance/cli-common'
import { Command } from 'commander'
import { manageInitBond } from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'
import { configureInitBond } from '@marinade.finance/validator-bonds-cli-core'

export function installInitBond(program: Command) {
  configureInitBond(program)
    .option(
      '--config <pubkey>',
      'The config account that the bond is created under. ' +
        `(default: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
      parsePubkey,
    )
    .action(
      async ({
        config,
        voteAccount,
        validatorIdentity,
        bondAuthority,
        rentPayer,
        cpmpe = new BN(0),
      }: {
        config?: Promise<PublicKey>
        voteAccount: Promise<PublicKey>
        validatorIdentity?: Promise<WalletInterface | PublicKey>
        bondAuthority: Promise<PublicKey>
        rentPayer?: Promise<WalletInterface | PublicKey>
        cpmpe: BN
      }) => {
        await manageInitBond({
          config: (await config) ?? MARINADE_CONFIG_ADDRESS,
          voteAccount: await voteAccount,
          validatorIdentity: await validatorIdentity,
          bondAuthority: await bondAuthority,
          rentPayer: await rentPayer,
          cpmpe,
          maxStakeWanted: undefined,
        })
      },
    )
}
