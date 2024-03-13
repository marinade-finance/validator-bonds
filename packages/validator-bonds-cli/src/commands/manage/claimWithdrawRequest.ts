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
  MARINADE_CONFIG_ADDRESS,
  orchestrateWithdrawDeposit,
} from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import { PublicKey, Signer } from '@solana/web3.js'
import { getWithdrawRequestFromAddress } from '../utils'

export function installClaimWithdrawRequest(program: Command) {
  program
    .command('claim-withdraw-request')
    .description(
      'Claiming an existing withdraw request (proven as an existing account on-chain) ' +
        'that the lockup period time elapses after its creation.'
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
      '--split-stake-rent-payer <keypair_or_ledger_or_pubkey>',
      'Rent payer for the split stake account creation. ' +
        'The split stake account is needed when the amount of lamports in the --stake-account ' +
        'is greater than the amount of lamports defined within the existing withdraw request account, ' +
        'then the splitted stake account remains under bond as funded (default: wallet keypair)',
      parseWalletOrPubkey
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
          splitStakeRentPayer,
        }: {
          config?: Promise<PublicKey>
          voteAccount?: Promise<PublicKey>
          authority?: Promise<WalletInterface | PublicKey>
          splitStakeRentPayer?: Promise<WalletInterface | PublicKey>
        }
      ) => {
        await manageClaimWithdrawRequest({
          withdrawRequestOrBondOrVoteAccountAddress:
            await withdrawRequestOrBondOrVoteAccountAddress,
          config: await config,
          voteAccount: await voteAccount,
          authority: await authority,
          splitStakeRentPayer: await splitStakeRentPayer,
        })
      }
    )
}

async function manageClaimWithdrawRequest({
  withdrawRequestOrBondOrVoteAccountAddress,
  config,
  voteAccount,
  authority,
  splitStakeRentPayer,
}: {
  withdrawRequestOrBondOrVoteAccountAddress?: PublicKey
  config?: PublicKey
  voteAccount?: PublicKey
  authority?: WalletInterface | PublicKey
  splitStakeRentPayer?: WalletInterface | PublicKey
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

  splitStakeRentPayer = splitStakeRentPayer ?? wallet.publicKey
  if (instanceOfWallet(splitStakeRentPayer)) {
    signers.push(splitStakeRentPayer)
    splitStakeRentPayer = splitStakeRentPayer.publicKey
  }
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

  const {
    instructions,
    withdrawRequestAccount,
    stakeAccount,
    splitStakeAccount,
  } = await orchestrateWithdrawDeposit({
    program,
    withdrawRequestAccount: withdrawRequestAddress,
    bondAccount,
    splitStakeRentPayer,
  })
  signers.push(splitStakeAccount)
  tx.add(...instructions)

  logger.info(
    `Claiming withdraw request account ${withdrawRequestAccount.toBase58()} ` +
      `for bond account ${bondAccount?.toBase58()} with stake account ${stakeAccount.toBase58()}`
  )
  await executeTx({
    connection: provider.connection,
    transaction: tx,
    errMessage: `Failed to claim withdraw request ${withdrawRequestAccount.toBase58()}`,
    signers,
    logger,
    simulate,
    printOnly,
    confirmOpts: confirmationFinality,
  })
  logger.info(
    `Withdraw request account ${withdrawRequestAccount.toBase58()} ` +
      `for bond account ${bondAccount?.toBase58()} successfully claimed`
  )
}
