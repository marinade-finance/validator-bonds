import { logDebug, logInfo } from '@marinade.finance/ts-common'
import {
  bondsWithdrawerAuthority,
  fundBondInstruction,
} from '@marinade.finance/validator-bonds-sdk'
import {
  executeTx,
  getStakeAccount,
  instanceOfWallet,
  parsePubkey,
  parsePubkeyOrPubkeyFromWallet,
  parseWalletOrPubkeyOption,
  transaction,
} from '@marinade.finance/web3js-1x'

import {
  FUND_BOND_LIMIT_UNITS,
  computeUnitLimitOption,
} from '../../computeUnits'
import { setProgramIdByOwner } from '../../context'
import {
  getBondFromAddress,
  isExpectedAnchorTransactionError,
} from '../../utils'

import type { LoggerPlaceholder } from '@marinade.finance/ts-common'
import type {
  Wallet as WalletInterface,
  Provider,
  Wallet,
} from '@marinade.finance/web3js-1x'
import type { PublicKey, Signer } from '@solana/web3.js'
import type { Command } from 'commander'

export function configureFundBond(program: Command): Command {
  return program
    .command('fund-bond')
    .description(
      'Funding a bond account with amount of SOL within a stake account.'
    )
    .argument(
      '<address>',
      'Address of the bond account or vote account.',
      parsePubkey
    )
    .requiredOption(
      '--stake-account <pubkey>',
      'Stake account that is used to fund the bond account',
      parsePubkeyOrPubkeyFromWallet
    )
    .option(
      '--stake-authority <keypair_or_ledger_or_pubkey>',
      'Stake account authority (probably the withdrawer authority) ' +
        'that is permitted to sign stake account authority changes. ' +
        '(default: wallet keypair)',
      parseWalletOrPubkeyOption
    )
    .addOption(computeUnitLimitOption(FUND_BOND_LIMIT_UNITS))
}

export async function manageFundBond({
  address,
  config,
  stakeAccount,
  stakeAuthority,
  computeUnitLimit,
}: {
  address: PublicKey
  config?: PublicKey
  stakeAccount: PublicKey
  stakeAuthority?: WalletInterface | PublicKey
  computeUnitLimit: number
}) {
  const {
    program,
    programId,
    provider,
    logger,
    computeUnitPrice,
    simulate,
    printOnly,
    wallet,
    confirmationFinality,
    confirmWaitTime,
    skipPreflight,
  } = await setProgramIdByOwner(config)

  const tx = await transaction(provider)
  const signers: (Signer | Wallet)[] = [wallet]

  stakeAuthority = stakeAuthority ?? wallet.publicKey
  if (instanceOfWallet(stakeAuthority)) {
    signers.push(stakeAuthority)
    stakeAuthority = stakeAuthority.publicKey
  }

  const bondAccountData = await getBondFromAddress({
    program,
    address,
    config,
    logger,
  })
  const bondAccountAddress = bondAccountData.publicKey
  config = bondAccountData.account.data.config
  const voteAccount = bondAccountData.account.data.voteAccount

  const { instruction, bondAccount } = await fundBondInstruction({
    program,
    bondAccount: bondAccountAddress,
    configAccount: config,
    voteAccount,
    stakeAccount,
    stakeAccountAuthority: stakeAuthority,
  })
  tx.add(instruction)

  logger.info(`Funding bond account ${bondAccount.toBase58()}`)
  try {
    await executeTx({
      connection: provider.connection,
      transaction: tx,
      errMessage: `'Failed to fund bond account ${bondAccount.toBase58()}`,
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
      `Bond account ${bondAccount.toBase58()} successfully funded ` +
        `with stake account ${stakeAccount.toBase58()}`
    )
  } catch (err) {
    await failIfUnexpectedFundingError({
      err,
      logger,
      provider,
      config,
      programId,
      stakeAccount,
      bondAccount,
    })
  }
}

export async function failIfUnexpectedFundingError({
  err,
  logger,
  provider,
  config,
  programId,
  stakeAccount,
  bondAccount,
}: {
  err: unknown
  logger: LoggerPlaceholder
  provider: Provider
  config: PublicKey
  programId: PublicKey | undefined
  stakeAccount: PublicKey
  bondAccount: PublicKey
}) {
  if (
    isExpectedAnchorTransactionError(
      err,
      'wrong withdrawer authority of the stake account'
    )
  ) {
    // it could be a stake account that's already funded, let's check it
    const [bondsWithdrawerAuth] = bondsWithdrawerAuthority(config, programId)
    const stakeAccountData = await getStakeAccount(
      provider.connection,
      stakeAccount
    )
    if (stakeAccountData.withdrawer?.equals(bondsWithdrawerAuth)) {
      logDebug(
        logger,
        `Bonds withdrawer authority '${bondsWithdrawerAuth.toBase58()}' for config '${config.toBase58()}' and program id '${programId?.toBase58()}'`
      )
      logInfo(
        logger,
        `The stake account ${stakeAccount.toBase58()} is ALREADY funded ` +
          `to bond account ${bondAccount.toBase58()}.`
      )
      return
    }
  }
  throw err
}
