import {
  CLOSE_SETTLEMENT_LIMIT_UNITS,
  computeUnitLimitOption,
  getCliContext,
} from '@marinade.finance/validator-bonds-cli-core'
import {
  closeSettlementV2Instruction,
  getBond,
  getSettlement,
} from '@marinade.finance/validator-bonds-sdk'
import {
  executeTx,
  parsePubkey,
  parseWalletOrPubkeyOption,
  transaction,
} from '@marinade.finance/web3js-1x'

import type { Wallet } from '@marinade.finance/web3js-1x'
import type { PublicKey, Signer } from '@solana/web3.js'
import type { Command } from 'commander'

export function installCloseSettlement(program: Command) {
  program
    .command('close-settlement')
    .description(
      'Closing Settlement. It is a permission-less action permitted when the Settlement expires. ' +
        'To finalize closing the dangling stake accounts need to be reset.',
    )
    .argument(
      '<settlement-address>',
      'Settlement account to be closed.',
      parsePubkey,
    )
    .option(
      '--refund-stake-account <pubkey>',
      'Refund stake account to be used to take funds from to return rent. ' +
        'The stake account has to be assigned to the Settlement address. ' +
        'When not provided the blockchain is parsed to find some.',
      parseWalletOrPubkeyOption,
    )
    .addOption(computeUnitLimitOption(CLOSE_SETTLEMENT_LIMIT_UNITS))
    .action(
      async (
        address: Promise<PublicKey>,
        {
          refundStakeAccount,
          computeUnitLimit,
        }: {
          refundStakeAccount?: Promise<PublicKey>
          computeUnitLimit: number
        },
      ) => {
        await manageCloseSettlement({
          address: await address,
          refundStakeAccount: await refundStakeAccount,
          computeUnitLimit,
        })
      },
    )
}

export async function manageCloseSettlement({
  address,
  refundStakeAccount,
  computeUnitLimit,
}: {
  address: PublicKey
  refundStakeAccount?: PublicKey
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

  const settlementData = await getSettlement(program, address)
  const bondData = await getBond(program, settlementData.bond)

  const { instruction } = await closeSettlementV2Instruction({
    program,
    settlementAccount: address,
    configAccount: bondData.config,
    bondAccount: settlementData.bond,
    voteAccount: bondData.voteAccount,
    rentCollector: settlementData.rentCollector,
    splitRentCollector: settlementData.splitRentCollector,
    splitRentRefundAccount: refundStakeAccount,
    logger,
  })

  const tx = await transaction(provider)
  const signers: (Signer | Wallet)[] = [wallet]
  tx.add(instruction)

  logger.info(`Closing settlement account ${address.toBase58()}`)
  await executeTx({
    connection: provider.connection,
    transaction: tx,
    errMessage: `'Failed to close settlement ${address.toBase58()}`,
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
  logger.info(`Settlement account ${address.toBase58()} successfully closed`)
}
