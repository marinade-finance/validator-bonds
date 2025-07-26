import {
  CliCommandError,
  parsePubkey,
  parsePubkeyOrPubkeyFromWallet,
  parseWalletOrPubkey,
} from '@marinade.finance/cli-common'
import { Command } from 'commander'
import { setProgramIdByOwner } from '../../context'
import {
  ExecutionError,
  U64_MAX,
  Wallet,
  executeTx,
  instanceOfWallet,
  transaction,
} from '@marinade.finance/web3js-common'
import {
  checkAndGetBondAddress,
  getBond,
  getConfig,
  getRentExemptStake,
  initWithdrawRequestInstruction,
  ValidatorBondsProgram,
} from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import { PublicKey, Signer } from '@solana/web3.js'
import BN from 'bn.js'
import {
  formatToSol,
  formatToSolWithAll,
  getBondFromAddress,
} from '../../utils'
import { INIT_WITHDRAW_REQUEST_LIMIT_UNITS } from '../../computeUnits'
import { Logger } from 'pino'

export function configureInitWithdrawRequest(program: Command): Command {
  return program
    .command('init-withdraw-request')
    .description(
      'Initializing withdrawal by creating a request ticket. ' +
        'The withdrawal request ticket is used to indicate a desire to withdraw the specified amount ' +
        'of lamports after the lockup period expires.',
    )
    .argument(
      '[address]',
      'Address of the bond account to withdraw funds from. Provide: bond or vote account address. ' +
        'When the [address] is not provided, both the --config and --vote-account options are required.',
      parsePubkey,
    )
    .option(
      '--vote-account <pubkey>',
      '(optional when the argument "address" is NOT provided, used to derive the bond address) ' +
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
    .requiredOption(
      '--amount <lamports | ALL>',
      'Maximal number of **lamports** to withdraw from the bond ' +
        '(NOTE: consider staking rewards can be added to stake accounts during the time the withdraw request claiming time is elapsing). ' +
        'If the bond should be fully withdrawn, use "ALL" instead of the amount.',
    )
    .option(
      '--rent-payer <keypair_or_ledger_or_pubkey>',
      'Rent payer for the account creation (default: wallet keypair)',
      parseWalletOrPubkey,
    )
    .option(
      '--compute-unit-limit <number>',
      'Compute unit limit for the transaction (default value based on the operation type)',
      v => parseInt(v, 10),
      INIT_WITHDRAW_REQUEST_LIMIT_UNITS,
    )
}

export async function manageInitWithdrawRequest({
  address,
  config,
  voteAccount,
  authority,
  amount,
  rentPayer,
  computeUnitLimit,
}: {
  address?: PublicKey
  config: PublicKey
  voteAccount?: PublicKey
  authority?: WalletInterface | PublicKey
  amount: string
  rentPayer?: WalletInterface | PublicKey
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
  } = await setProgramIdByOwner(config)

  const tx = await transaction(provider)
  const signers: (Signer | Wallet)[] = [wallet]

  rentPayer = rentPayer ?? wallet.publicKey
  if (instanceOfWallet(rentPayer)) {
    signers.push(rentPayer)
    rentPayer = rentPayer.publicKey
  }
  authority = authority ?? wallet.publicKey
  if (instanceOfWallet(authority)) {
    signers.push(authority)
    authority = authority.publicKey
  }

  let bondAccountAddress = address
  if (address !== undefined) {
    const bondAccountData = await getBondFromAddress({
      program,
      address,
      config,
      logger,
    })
    bondAccountAddress = bondAccountData.publicKey
    config = bondAccountData.account.data.config
    voteAccount = bondAccountData.account.data.voteAccount
  }

  // config account is required
  bondAccountAddress = checkAndGetBondAddress(
    bondAccountAddress,
    config,
    voteAccount,
    program.programId,
  )
  if (voteAccount === undefined || config === undefined) {
    const bondData = await getBond(program, bondAccountAddress)
    voteAccount = voteAccount ?? bondData.voteAccount
    config = config ?? bondData.config
  }

  let amountBN: BN
  if (amount === 'ALL') {
    amountBN = U64_MAX
  } else {
    amountBN = new BN(amount)

    // withdraw request may withdraw only if possible to create a separate stake account,
    // or when withdrawing whole stake account, the amount is greater to minimal stake account "size"
    const configData = await getConfig(program, config)
    const rentExemptStake = await getRentExemptStake(provider)
    const minimalAmountToWithdraw = configData.minimumStakeLamports.add(
      new BN(rentExemptStake),
    )
    if (amountBN.lt(minimalAmountToWithdraw)) {
      throw new CliCommandError({
        valueName: '--amount <lamports>',
        value: `${amountBN.toString()} (${formatToSol(amountBN)})`,
        msg:
          `The requested amount ${amountBN.toString()} lamports is less than the minimal amount ` +
          `${minimalAmountToWithdraw.toString()} lamports, required to manage a stake account after withdrawal.`,
      })
    }
  }

  const { instruction, bondAccount, withdrawRequestAccount } =
    await initWithdrawRequestInstruction({
      program,
      bondAccount: bondAccountAddress,
      configAccount: config,
      voteAccount,
      authority,
      amount: amountBN,
      rentPayer,
      logger,
    })
  tx.add(instruction)

  logger.info(
    `Initializing withdraw request account ${withdrawRequestAccount.toBase58()} (amount: ` +
      `${formatToSolWithAll(
        amountBN,
      )}) for bond account ${bondAccount.toBase58()}`,
  )
  try {
    await executeTx({
      connection: provider.connection,
      transaction: tx,
      errMessage: `Failed to initialize withdraw request ${withdrawRequestAccount.toBase58()}`,
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
        `for bond account ${bondAccount.toBase58()} successfully initialized`,
    )
  } catch (err) {
    await failIfUnexpectedError({
      err,
      logger,
      program,
      withdrawRequestAccount,
    })
  }
}

async function failIfUnexpectedError({
  err,
  logger,
  program,
  withdrawRequestAccount,
}: {
  err: unknown
  logger: Logger
  program: ValidatorBondsProgram
  withdrawRequestAccount: PublicKey
}) {
  if (
    err instanceof ExecutionError &&
    err.messageWithCause().includes('custom program error: 0x0')
  ) {
    const withdrawRequestData =
      await program.account.withdrawRequest.fetchNullable(
        withdrawRequestAccount,
      )
    if (withdrawRequestData !== null) {
      logger.info(
        `The withdraw request ${withdrawRequestAccount.toBase58()} ALREADY exists on-chain. ` +
          `The requested amount ${formatToSolWithAll(
            withdrawRequestData.requestedAmount,
          )}, ` +
          `with withdrawn amount ${formatToSolWithAll(
            withdrawRequestData.withdrawnAmount,
          )}.\n` +
          '  If you want to withdraw more, consider canceling the existing request and creating a new withdraw request.',
      )
      return
    }
  }
  throw err
}
