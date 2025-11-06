import { CliCommandError } from '@marinade.finance/cli-common'
import {
  RESET_STAKE_LIMIT_UNITS,
  computeUnitLimitOption,
  getCliContext,
} from '@marinade.finance/validator-bonds-cli-core'
import { resetStakeInstruction } from '@marinade.finance/validator-bonds-sdk'
import {
  executeTx,
  parsePubkey,
  parseWalletOrPubkeyOption,
  transaction,
} from '@marinade.finance/web3js-1x'

import type { Wallet } from '@marinade.finance/web3js-1x'
import type { PublicKey, Signer } from '@solana/web3.js'
import type { Command } from 'commander'

export function installResetStake(program: Command) {
  program
    .command('reset-stake')
    .description(
      'Resetting stake that is not associated to a closed Settlement. ' +
        'The stake account is to be returned to Bond then used for funding another settlement.',
    )
    .argument('<address>', 'Stake account account to be reset', parsePubkey)
    .requiredOption(
      '--settlement <pubkey>',
      'The closed settlement account that the stake account is associated with.',
      parseWalletOrPubkeyOption,
    )
    .requiredOption(
      '--bond <pubkey>',
      'Bond account that the closed settlement account was associated with.',
      parseWalletOrPubkeyOption,
    )
    .addOption(computeUnitLimitOption(RESET_STAKE_LIMIT_UNITS))
    .action(
      async (
        address: Promise<PublicKey>,
        {
          settlement,
          bond,
          computeUnitLimit,
        }: {
          settlement: Promise<PublicKey>
          bond: Promise<PublicKey>
          computeUnitLimit: number
        },
      ) => {
        await manageResetStake({
          address: await address,
          settlement: await settlement,
          bond: await bond,
          computeUnitLimit,
        })
      },
    )
}

export async function manageResetStake({
  address,
  settlement,
  bond,
  computeUnitLimit,
}: {
  address: PublicKey
  settlement: PublicKey
  bond: PublicKey
  computeUnitLimit: number
}) {
  const {
    program,
    provider,
    logger,
    computeUnitPrice,
    simulate,
    printOnly,
    wallet,
    confirmationFinality,
    confirmWaitTime,
    skipPreflight,
  } = getCliContext()

  const settlementData = await provider.connection.getAccountInfo(settlement)
  if (settlementData !== null) {
    throw new CliCommandError({
      msg: `Settlement account ${settlement.toBase58()} is not closed, cannot reset stake ${address.toBase58()}`,
    })
  }

  const { instruction } = await resetStakeInstruction({
    program,
    stakeAccount: address,
    settlementAccount: settlement,
    bondAccount: bond,
  })

  const tx = await transaction(provider)
  const signers: (Signer | Wallet)[] = [wallet]
  tx.add(instruction)

  logger.info(
    `Resetting stake ${address.toBase58()} for closed settlement account ${settlement.toBase58()}`,
  )
  await executeTx({
    connection: provider.connection,
    transaction: tx,
    errMessage: `'Failed to reset stake ${address.toBase58()}`,
    signers,
    logger,
    computeUnitLimit,
    computeUnitPrice,
    simulate,
    printOnly,
    confirmOpts: confirmationFinality,
    confirmWaitTime,
    sendOpts: { skipPreflight },
  })
  logger.info(`Stake account ${address.toBase58()} successfully reset`)
}
