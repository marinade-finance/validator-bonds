import { Command } from 'commander'
import { manageInitBond } from '@marinade.finance/validator-bonds-cli-core'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-1x'
import { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'
import { configureInitBond } from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_INSTITUTIONAL_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'

export function installInitBond(program: Command) {
  configureInitBond(program).action(
    async ({
      voteAccount,
      validatorIdentity,
      bondAuthority,
      rentPayer,
      cpmpe = new BN(0),
      maxStakeWanted = new BN(0),
      computeUnitLimit,
    }: {
      voteAccount: Promise<PublicKey>
      validatorIdentity?: Promise<WalletInterface | PublicKey>
      bondAuthority: Promise<PublicKey>
      rentPayer?: Promise<WalletInterface | PublicKey>
      cpmpe: BN
      maxStakeWanted: BN
      computeUnitLimit: number
    }) => {
      await manageInitBond({
        config: MARINADE_INSTITUTIONAL_CONFIG_ADDRESS,
        voteAccount: await voteAccount,
        validatorIdentity: await validatorIdentity,
        bondAuthority: await bondAuthority,
        rentPayer: await rentPayer,
        cpmpe,
        maxStakeWanted,
        computeUnitLimit,
      })
    },
  )
}
