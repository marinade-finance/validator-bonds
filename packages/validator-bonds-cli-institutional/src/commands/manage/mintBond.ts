import { PublicKey } from '@solana/web3.js'
import { Command } from 'commander'
import {
  configureMintBond,
  manageMintBond,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_INSTITUTIONAL_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-1x'

export function installMintBond(program: Command) {
  configureMintBond(program).action(
    async (
      address: Promise<PublicKey>,
      {
        voteAccount,
        rentPayer,
        computeUnitLimit,
      }: {
        voteAccount?: Promise<PublicKey>
        rentPayer?: Promise<WalletInterface | PublicKey>
        computeUnitLimit: number
      },
    ) => {
      await manageMintBond({
        address: await address,
        config: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
        voteAccount: await voteAccount,
        rentPayer: await rentPayer,
        computeUnitLimit,
      })
    },
  )
}
