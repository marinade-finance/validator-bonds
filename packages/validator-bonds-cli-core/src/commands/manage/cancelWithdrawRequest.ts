import { cancelWithdrawRequestInstruction } from '@marinade.finance/validator-bonds-sdk'
import {
  executeTx,
  instanceOfWallet,
  parsePubkey,
  parsePubkeyOrPubkeyFromWallet,
  parseWalletOrPubkeyOption,
  transaction,
} from '@marinade.finance/web3js-1x'

import {
  CANCEL_WITHDRAW_REQUEST_LIMIT_UNITS,
  computeUnitLimitOption,
} from '../../computeUnits'
import { getCliContext } from '../../context'
import { getBondFromAddress, getWithdrawRequestFromAddress } from '../../utils'

import type {
  Wallet,
  Wallet as WalletInterface,
} from '@marinade.finance/web3js-1x'
import type { PublicKey, Signer } from '@solana/web3.js'
import type { Command } from 'commander'

export function configureCancelWithdrawRequest(program: Command): Command {
  return program
    .command('cancel-withdraw-request')
    .description(
      'Cancelling the withdraw request account, which is the withdrawal request ticket, ' +
        'by removing the account from the chain.',
    )
    .argument(
      '[request-or-bond-or-vote]',
      'Withdraw request account to be cancelled. Provide: withdraw request, bond or vote account address. ' +
        'When the [address] is not provided, both the --config and --vote-account options are required.',
      parsePubkey,
    )
    .option(
      '--vote-account <pubkey>',
      '(optional when the argument "address" is NOT provided, ' +
        'used to derive the withdraw request address) ' +
        'Validator vote account that the bond is bound to',
      parsePubkeyOrPubkeyFromWallet,
    )
    .option(
      '--authority <keypair-or-ledger-or-pubkey>',
      'Authority that is permitted to do changes in the bond account. ' +
        'It is either the authority defined in the bond account or ' +
        'vote account validator identity that the bond account is connected to. ' +
        '(default: wallet keypair)',
      parseWalletOrPubkeyOption,
    )
    .option(
      '--rent-collector <pubkey>',
      'Collector of rent from initialized withdraw request account (default: wallet pubkey)',
      parsePubkeyOrPubkeyFromWallet,
    )
    .addOption(computeUnitLimitOption(CANCEL_WITHDRAW_REQUEST_LIMIT_UNITS))
}

export async function manageCancelWithdrawRequest({
  address,
  config,
  voteAccount,
  authority,
  rentCollector,
  computeUnitLimit,
}: {
  address?: PublicKey
  config?: PublicKey
  voteAccount?: PublicKey
  authority?: WalletInterface | PublicKey
  rentCollector?: PublicKey
  computeUnitLimit: number
}) {
  const {
    program,
    provider,
    logger,
    simulate,
    printOnly,
    wallet,
    confirmationFinality,
    computeUnitPrice,
    confirmWaitTime,
    skipPreflight,
  } = getCliContext()

  const tx = await transaction(provider)
  const signers: (Signer | Wallet)[] = [wallet]

  let bondAccount: PublicKey | undefined = undefined
  let withdrawRequestAddress = address
  if (address !== undefined) {
    const withdrawRequestAccountData = await getWithdrawRequestFromAddress({
      program,
      address,
      config,
      logger,
    })
    withdrawRequestAddress = withdrawRequestAccountData.publicKey
    voteAccount = withdrawRequestAccountData.account.data.voteAccount
    bondAccount = withdrawRequestAccountData.account.data.bond
  }

  if (!authority && (bondAccount !== undefined || voteAccount !== undefined)) {
    const bondAccountData = await getBondFromAddress({
      program,
      address: (bondAccount !== undefined
        ? bondAccount
        : voteAccount) as PublicKey,
      config,
      logger,
    })
    authority = bondAccountData.account.data.authority
  } else {
    authority = authority ?? wallet.publicKey
  }
  if (instanceOfWallet(authority)) {
    signers.push(authority)
    authority = authority.publicKey
  }

  const { instruction, withdrawRequestAccount } =
    await cancelWithdrawRequestInstruction({
      program,
      withdrawRequestAccount: withdrawRequestAddress,
      bondAccount,
      configAccount: config,
      voteAccount,
      authority,
      rentCollector,
      logger,
    })
  tx.add(instruction)

  logger.info(
    `Cancelling withdraw request account ${withdrawRequestAccount.toBase58()} ` +
      `for bond account ${bondAccount?.toBase58()}`,
  )
  await executeTx({
    connection: provider.connection,
    transaction: tx,
    errMessage: `Failed to cancel withdraw request ${withdrawRequestAccount.toBase58()}`,
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
    `Withdraw request account ${withdrawRequestAccount.toBase58()} ` +
      `for bond account ${bondAccount?.toBase58()} successfully cancelled`,
  )
}
