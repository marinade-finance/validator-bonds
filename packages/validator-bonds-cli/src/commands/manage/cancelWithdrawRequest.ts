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

export function installCancelWithdrawRequest(program: Command) {
  program
    .command('cancel-withdraw-request')
    .description(
      'Initialization withdrawing by creating a request ticket. ' +
        'The request ticket is used to withdraw lamports from a funded stake account after the lockup period elapses.'
    )
    .argument(
      '[withdraw-request-or-bond-or-vote-account-address]',
      'Address of the bond account to withdraw funds from. ' +
        'When the address is not provided then this command requires ' +
        '--config and --vote-account options to be defined',
      parsePubkey
    )
    .option(
      '--config <pubkey>',
      '(optional when the argument "withdraw-request-or-bond-or-vote-account-address" is NOT provided, ' +
        'used to derive the withdraw request address) ' +
        `The config account that the bond is created under (default: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
      parsePubkey
    )
    .option(
      '--vote-account <pubkey>',
      '(optional when the argument "withdraw-request-or-bond-or-vote-account-address" is NOT provided, ' +
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
        withdrawRequestOrBondOrVoteAccountAddress: Promise<
          PublicKey | undefined
        >,
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
          withdrawRequestOrBondOrVoteAccountAddress:
            await withdrawRequestOrBondOrVoteAccountAddress,
          config: await config,
          voteAccount: await voteAccount,
          authority: await authority,
          rentCollector: await rentCollector,
        })
      }
    )
}

async function manageCancelWithdrawRequest({
  withdrawRequestOrBondOrVoteAccountAddress,
  config,
  voteAccount,
  authority,
  rentCollector,
}: {
  withdrawRequestOrBondOrVoteAccountAddress?: PublicKey
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
  } = await setProgramIdByOwner(config)

  const tx = await transaction(provider)
  const signers: (Signer | Wallet)[] = [wallet]

  authority = authority ?? wallet.publicKey
  if (instanceOfWallet(authority)) {
    signers.push(authority)
    authority = authority.publicKey
  }

  let bondAccount: PublicKey | undefined = undefined
  let withdrawRequestAddress = withdrawRequestOrBondOrVoteAccountAddress
  if (withdrawRequestOrBondOrVoteAccountAddress !== undefined) {
    const withdrawRequestAccountData = await getWithdrawRequestFromAddress({
      program,
      address: withdrawRequestOrBondOrVoteAccountAddress,
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
    simulate,
    printOnly,
    confirmOpts: confirmationFinality,
  })
  logger.info(
    `Withdraw request account ${withdrawRequestAccount.toBase58()} ` +
      `for bond account ${bondAccount?.toBase58()} successfully cancelled`
  )
}
