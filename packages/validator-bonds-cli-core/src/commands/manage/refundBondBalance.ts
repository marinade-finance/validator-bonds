import {
  findBondNonSettlementStakeAccounts,
  refundBondBalanceInstruction,
} from '@marinade.finance/validator-bonds-sdk'
import { parsePubkey, transaction } from '@marinade.finance/web3js-1x'

import {
  recordAmountLamports,
  recordResolvedAccounts,
  setProgramTelemetryFields,
} from '../../cliUsage'
import {
  REFUND_BOND_BALANCE_LIMIT_UNITS,
  computeUnitLimitOption,
} from '../../computeUnits'
import { getCliContext } from '../../context'
import {
  executeTxHandleErrors,
  formatToSol,
  getBondFromAddress,
} from '../../utils'

import type { Wallet } from '@marinade.finance/web3js-1x'
import type { PublicKey, Signer } from '@solana/web3.js'
import type { Command } from 'commander'

export function configureRefundBondBalance(program: Command): Command {
  return setProgramTelemetryFields(program.command('refund-bond-balance'), {
    accountField: 'account',
  })
    .description(
      'Refund SOL mistakenly transferred to the bond account address. ' +
        'Lamports above the rent-exempt minimum are moved onto an existing ' +
        'bond-funded stake account, becoming part of the bond funding.',
    )
    .argument(
      '<bond-or-vote>',
      'Address of the bond account or vote account.',
      parsePubkey,
    )
    .option(
      '--stake-account <pubkey>',
      'Bond-funded stake account the lamports are credited to ' +
        '(default: the smallest bond-funded stake account)',
      parsePubkey,
    )
    .addOption(computeUnitLimitOption(REFUND_BOND_BALANCE_LIMIT_UNITS))
}

export async function manageRefundBondBalance({
  address,
  config,
  stakeAccount,
  computeUnitLimit,
}: {
  address: PublicKey
  config?: PublicKey
  stakeAccount?: PublicKey
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

  const tx = await transaction(provider, wallet)
  const signers: (Signer | Wallet)[] = [wallet]

  const bondAccountData = await getBondFromAddress({
    program,
    address,
    config,
    logger,
  })
  const bondAccount = bondAccountData.publicKey
  config = bondAccountData.account.data.config
  const voteAccount = bondAccountData.account.data.voteAccount

  const bondAccountInfo = await provider.connection.getAccountInfo(bondAccount)
  if (bondAccountInfo === null) {
    throw new Error(`Bond account ${bondAccount.toBase58()} does not exist`)
  }
  const rentExempt =
    await provider.connection.getMinimumBalanceForRentExemption(
      bondAccountInfo.data.length,
    )
  const excessLamports = bondAccountInfo.lamports - rentExempt
  if (excessLamports <= 0) {
    throw new Error(
      `Bond account ${bondAccount.toBase58()} has no lamports above ` +
        `the rent-exempt minimum of ${formatToSol(rentExempt)}. ` +
        'There is nothing to refund.',
    )
  }
  recordAmountLamports(excessLamports.toString())

  if (stakeAccount === undefined) {
    const stakeAccounts = await findBondNonSettlementStakeAccounts({
      program,
      configAccount: config,
      bondAccount,
      voteAccount,
    })
    const eligible = stakeAccounts
      .filter(
        s =>
          s.account.data.activationEpoch !== null &&
          !s.account.data.isCoolingDown,
      )
      .sort((a, b) => a.account.lamports - b.account.lamports)
    const smallest = eligible.at(0)
    if (smallest === undefined) {
      throw new Error(
        `No bond-funded stake account found for bond ${bondAccount.toBase58()}. ` +
          "Fund the bond first with 'fund-bond-sol', then re-run this command.",
      )
    }
    stakeAccount = smallest.publicKey
  }
  recordResolvedAccounts({
    bondAccount,
    voteAccount,
    configAccount: config,
    stakeAccount,
  })

  const { instruction } = await refundBondBalanceInstruction({
    program,
    bondAccount,
    configAccount: config,
    voteAccount,
    stakeAccount,
  })
  tx.add(instruction)

  logger.info(
    `Refunding ${formatToSol(excessLamports)} from bond account ${bondAccount.toBase58()} ` +
      `of vote account ${voteAccount.toBase58()} to stake account ${stakeAccount.toBase58()}`,
  )
  await executeTxHandleErrors({
    connection: provider.connection,
    transaction: tx,
    errMessage:
      `Failed to refund bond account ${bondAccount.toBase58()} balance ` +
      `to stake account ${stakeAccount.toBase58()}`,
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
  logger.info(
    `Bond account ${bondAccount.toBase58()} balance of ${formatToSol(excessLamports)} ` +
      `successfully refunded to stake account ${stakeAccount.toBase58()}`,
  )
}
