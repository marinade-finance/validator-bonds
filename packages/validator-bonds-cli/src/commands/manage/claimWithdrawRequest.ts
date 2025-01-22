import {
  CliCommandError,
  parsePubkey,
  parsePubkeyOrPubkeyFromWallet,
  parseWalletOrPubkey,
} from '@marinade.finance/cli-common'
import { Command } from 'commander'
import { setProgramIdByOwner } from '../../context'
import {
  Wallet,
  instanceOfWallet,
  transaction,
  splitAndExecuteTx,
} from '@marinade.finance/web3js-common'
import {
  MARINADE_CONFIG_ADDRESS,
  orchestrateWithdrawDeposit,
  claimWithdrawRequestInstruction,
} from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import { PublicKey, Signer, TransactionInstruction } from '@solana/web3.js'
import { getWithdrawRequestFromAddress } from '../utils'
import { CLAIM_WITHDRAW_REQUEST_LIMIT_UNITS } from '../../computeUnits'
import { BN } from 'bn.js'

export function installClaimWithdrawRequest(program: Command) {
  program
    .command('claim-withdraw-request')
    .description(
      'Claiming an existing withdrawal request for an existing on-chain account, ' +
        'where the lockup period has expired. Withdrawing funds involves transferring ownership ' +
        'of a funded stake account to the specified "--withdrawer" public key. ' +
        'To withdraw, the authority signature of the bond account is required, specified by the "--authority" parameter (default wallet).',
    )
    .argument(
      '[address]',
      'Address of the withdrawal request or bond or vote account. ' +
        'When the [address] is not provided, both the --config and --vote-account options are required.',
      parsePubkey,
    )
    .option(
      '--config <pubkey>',
      '(optional when the argument "address" is NOT provided, ' +
        'used to derive the withdraw request address) ' +
        `The config account that the bond is created under (default: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
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
      '--authority <keypair_or_ledger_or_pubkey>',
      'Authority that is permitted to do changes in the bond account. ' +
        'It is either the authority defined in the bond account or ' +
        'vote account validator identity that the bond account is connected to. ' +
        '(default: wallet keypair)',
      parseWalletOrPubkey,
    )
    .option(
      '--withdrawer <pubkey>',
      'Pubkey to be new owner (withdrawer authority) ' +
        'of the stake accounts that are taken out of the Validator Bonds (default: wallet publickey)',
      parsePubkey,
    )
    .option(
      '--split-stake-rent-payer <keypair_or_ledger_or_pubkey>',
      'Rent payer for the split stake account creation. ' +
        'The split stake account is needed when the amount of lamports in the --stake-account ' +
        'is greater than the amount of lamports defined within the existing withdraw request account, ' +
        'then the splitted stake account remains under bond as funded (default: wallet keypair)',
      parseWalletOrPubkey,
    )
    .option(
      '--stake-account <pubkey>',
      'Use this parameter to force the CLI to use particular stake account for withdrawal. ' +
        'By default, the stake account searched from the list of available accounts assigned to Bond account, ' +
        'using this parameter enforces direct use of the stake account.',
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
        }: {
          config?: Promise<PublicKey>
          voteAccount?: Promise<PublicKey>
          authority?: Promise<WalletInterface | PublicKey>
          withdrawer?: Promise<PublicKey>
          splitStakeRentPayer?: Promise<WalletInterface | PublicKey>
          stakeAccount?: Promise<PublicKey>
        },
      ) => {
        await manageClaimWithdrawRequest({
          address: await address,
          config: await config,
          voteAccount: await voteAccount,
          authority: await authority,
          withdrawer: await withdrawer,
          splitStakeRentPayer: await splitStakeRentPayer,
          stakeAccount: await stakeAccount,
        })
      },
    )
}

async function manageClaimWithdrawRequest({
  address,
  config,
  voteAccount,
  authority,
  withdrawer,
  splitStakeRentPayer,
  stakeAccount,
}: {
  address?: PublicKey
  config?: PublicKey
  voteAccount?: PublicKey
  authority?: WalletInterface | PublicKey
  withdrawer?: PublicKey
  splitStakeRentPayer?: WalletInterface | PublicKey
  stakeAccount?: PublicKey
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

  withdrawer = withdrawer ?? wallet.publicKey

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

  let instructionsToProcess: TransactionInstruction[] = []
  let stakeAccountsToWithdraw: PublicKey[] = []
  if (stakeAccount !== undefined) {
    // forced to use provided stake account
    const { instruction, withdrawRequestAccount, splitStakeAccount } =
      await claimWithdrawRequestInstruction({
        program,
        withdrawRequestAccount: withdrawRequestAddress,
        bondAccount,
        configAccount: config,
        voteAccount,
        stakeAccount,
        authority,
        splitStakeRentPayer,
        withdrawer,
      })
    signers.push(splitStakeAccount)
    withdrawRequestAddress = withdrawRequestAccount
    instructionsToProcess = [instruction]
    stakeAccountsToWithdraw = [stakeAccount]
  } else {
    // default behaviour to search stake account from bond account and merge beforehand
    const {
      instructions,
      withdrawStakeAccounts,
      splitStakeAccounts,
      withdrawRequestAccount,
      amountToWithdraw,
    } = await orchestrateWithdrawDeposit({
      program,
      withdrawRequestAccount: withdrawRequestAddress,
      bondAccount,
      voteAccount,
      configAccount: config,
      authority,
      withdrawer,
      splitStakeRentPayer,
      logger,
    })
    signers.push(...splitStakeAccounts)
    withdrawRequestAddress = withdrawRequestAccount
    instructionsToProcess = instructions
    stakeAccountsToWithdraw = withdrawStakeAccounts
    if (amountToWithdraw <= new BN(0)) {
      logger.info(
        `Withdraw request ${withdrawRequestAddress.toBase58()} for bond account ${bondAccount?.toBase58()}` +
          'has been fully withdrawn, with nothing left to claim.\n' +
          'If you want to withdraw more funds, please cancel the current request and create a new one.',
      )
      return
    }
  }

  if (instructionsToProcess.length === 0) {
    throw new CliCommandError({
      commandName: '--claim-withdraw-request',
      valueName: 'address',
      value: withdrawRequestAddress.toBase58(),
      msg:
        'CLI internal error. No instruction for claiming generated. ' +
        'Try to run with --debug to get more info.',
    })
  }
  tx.add(...instructionsToProcess)

  logger.info(
    `Claiming withdraw request ${withdrawRequestAddress.toBase58()} ` +
      `for bond account ${bondAccount?.toBase58()} with stake accounts: [` +
      `${stakeAccountsToWithdraw.map(s => s.toBase58()).join(',')}]`,
  )
  await splitAndExecuteTx({
    connection: provider.connection,
    transaction: tx,
    errMessage: `Failed to claim withdraw requests ${withdrawRequestAddress.toBase58()}`,
    signers,
    logger,
    computeUnitLimit: CLAIM_WITHDRAW_REQUEST_LIMIT_UNITS,
    computeUnitPrice,
    simulate,
    printOnly,
    confirmOpts: confirmationFinality,
    confirmWaitTime,
    sendOpts: { skipPreflight },
  })
  logger.info(
    `Withdraw request accounts: ${withdrawRequestAddress.toBase58()} ` +
      `for bond account ${bondAccount?.toBase58()} successfully claimed`,
  )
}
