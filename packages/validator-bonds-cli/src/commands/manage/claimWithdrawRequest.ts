import { parsePubkey } from '@marinade.finance/cli-common'
import { Command } from 'commander'
import {
  configureClaimWithdrawRequest,
  manageClaimWithdrawRequest,
} from '@marinade.finance/validator-bonds-cli-core'
import { MARINADE_CONFIG_ADDRESS } from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import { PublicKey } from '@solana/web3.js'

export function installClaimWithdrawRequest(program: Command) {
  configureClaimWithdrawRequest(program)
    .option(
      '--config <pubkey>',
      '(optional when the argument "address" is NOT provided, ' +
        'used to derive the withdraw request address) ' +
        `The config account that the bond is created under (default: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
      parsePubkey,
    )
    .action(
      async (
        address: Promise<PublicKey | undefined>,
        {
          config,
          voteAccount,
          authority,
          withdrawer,
          splitStakeRentPayer,
          stakeAccount,
          computeUnitLimit,
        }: {
          config?: Promise<PublicKey>
          voteAccount?: Promise<PublicKey>
          authority?: Promise<WalletInterface | PublicKey>
          withdrawer?: Promise<PublicKey>
          splitStakeRentPayer?: Promise<WalletInterface | PublicKey>
          stakeAccount?: Promise<PublicKey>
          computeUnitLimit: number
        },
      ) => {
        await manageClaimWithdrawRequest({
          address: await address,
          config: (await config) ?? MARINADE_CONFIG_ADDRESS,
          voteAccount: await voteAccount,
          authority: await authority,
          withdrawer: await withdrawer,
          splitStakeRentPayer: await splitStakeRentPayer,
          stakeAccount: await stakeAccount,
          computeUnitLimit,
        })
      },
    )
}
