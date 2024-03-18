import {
  parsePubkey,
  parsePubkeyOrPubkeyFromWallet,
  parseWalletOrPubkey,
} from '@marinade.finance/cli-common'
import { Command } from 'commander'
import { setProgramIdByOwner } from '../../context'
import {
  Wallet,
  executeTx,
  instanceOfWallet,
  transaction,
} from '@marinade.finance/web3js-common'
import {
  cancelWithdrawRequestInstruction,
  MARINADE_CONFIG_ADDRESS,
} from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import { PublicKey, Signer } from '@solana/web3.js'
import { getWithdrawRequestFromAddress } from '../utils'
import { CANCEL_WITHDRAW_REQUEST_LIMIT_UNITS } from '../../computeUnits'

export function installCancelWithdrawRequest(program: Command) {
  program
    .command('cancel-withdraw-request')
    .description(
      'Cancelling the withdraw request account, which is the withdrawal request ticket, ' +
        'by removing the account from the chain.'
    )
    .argument(
      '[address]',
      'Withdraw request account to be cancelled. Provide: withdraw request, bond or vote account address. ' +
        'When the [address] is not provided, both the --config and --vote-account options are required.',
      parsePubkey
    )
    .option(
      '--config <pubkey>',
      '(optional when the argument "address" is NOT provided, ' +
        'used to derive the withdraw request address) ' +
        `The config account that the bond is created under (default: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
      parsePubkey
    )
    .option(
      '--vote-account <pubkey>',
      '(optional when the argument "address" is NOT provided, ' +
        'used to derive the withdraw request address) ' +
        'Validator vote account that the bond is bound to',
      parsePubkeyOrPubkeyFromWallet
    )
    .option(
      '--authority <keypair_or_ledger_or_pubkey>',
      'Authority that is permitted to do changes in the bond account. ' +
        'It is either the authority defined in the bond account or ' +
        'vote account validator identity that the bond account is connected to. ' +
        '(default: wallet keypair)',
      parseWalletOrPubkey
    )
    .option(
      '--rent-collector <pubkey>',
      'Collector of rent from initialized withdraw request account (default: wallet pubkey)',
      parsePubkeyOrPubkeyFromWallet
    )
    .action(
      async (
        address: Promise<PublicKey | undefined>,
        {
          config,
          voteAccount,
          authority,
          rentCollector,
        }: {
          config?: Promise<PublicKey>
          voteAccount?: Promise<PublicKey>
          authority?: Promise<WalletInterface | PublicKey>
          rentCollector?: Promise<PublicKey>
        }
      ) => {
        await manageCancelWithdrawRequest({
          address: await address,
          config: await config,
          voteAccount: await voteAccount,
          authority: await authority,
          rentCollector: await rentCollector,
        })
      }
    )
}

async function manageCancelWithdrawRequest({
  address,
  config,
  voteAccount,
  authority,
  rentCollector,
}: {
  address?: PublicKey
  config?: PublicKey
  voteAccount?: PublicKey
  authority?: WalletInterface | PublicKey
  rentCollector?: PublicKey
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
  } = await setProgramIdByOwner(config)

  const tx = await transaction(provider)
  const signers: (Signer | Wallet)[] = [wallet]

  authority = authority ?? wallet.publicKey
  if (instanceOfWallet(authority)) {
    signers.push(authority)
    authority = authority.publicKey
  }

  let bondAccount: PublicKey | undefined = undefined
  let withdrawRequestAddress = address
  if (address !== undefined) {
    const withdrawRequestAccountData = await getWithdrawRequestFromAddress({
      program,
      address: address,
      config,
      logger,
    })
    withdrawRequestAddress = withdrawRequestAccountData.publicKey
    voteAccount = withdrawRequestAccountData.account.data.voteAccount
    bondAccount = withdrawRequestAccountData.account.data.bond
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
    })
  tx.add(instruction)

  logger.info(
    `Cancelling withdraw request account ${withdrawRequestAccount.toBase58()} ` +
      `for bond account ${bondAccount?.toBase58()}`
  )
  await executeTx({
    connection: provider.connection,
    transaction: tx,
    errMessage: `Failed to cancel withdraw request ${withdrawRequestAccount.toBase58()}`,
    signers,
    logger,
    computeUnitLimit: CANCEL_WITHDRAW_REQUEST_LIMIT_UNITS,
    computeUnitPrice,
    simulate,
    printOnly,
    confirmOpts: confirmationFinality,
  })
  logger.info(
    `Withdraw request account ${withdrawRequestAccount.toBase58()} ` +
      `for bond account ${bondAccount?.toBase58()} successfully cancelled`
  )
}
