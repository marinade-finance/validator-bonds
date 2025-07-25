import {
  CliCommandError,
  parsePubkey,
  parseWalletOrPubkey,
} from '@marinade.finance/cli-common'
import { Command } from 'commander'
import { PublicKey, Signer } from '@solana/web3.js'
import { Wallet, executeTx, transaction } from '@marinade.finance/web3js-common'
import {
  RESET_STAKE_LIMIT_UNITS,
  setProgramIdByOwner,
} from '@marinade.finance/validator-bonds-cli-core'
import { resetStakeInstruction } from '@marinade.finance/validator-bonds-sdk'

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
      parseWalletOrPubkey,
    )
    .requiredOption(
      '--bond <pubkey>',
      'Bond account that the closed settlement account was associated with.',
      parseWalletOrPubkey,
    )
    .action(
      async (
        address: Promise<PublicKey>,
        {
          settlement,
          bond,
        }: {
          settlement: Promise<PublicKey>
          bond: Promise<PublicKey>
        },
      ) => {
        await manageResetStake({
          address: await address,
          settlement: await settlement,
          bond: await bond,
        })
      },
    )
}

export async function manageResetStake({
  address,
  settlement,
  bond,
}: {
  address: PublicKey
  settlement: PublicKey
  bond: PublicKey
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
  } = await setProgramIdByOwner(bond)

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
  const computeUnitLimit = RESET_STAKE_LIMIT_UNITS
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
