import {
  parsePubkey,
  parsePubkeyOrPubkeyFromWallet,
  parseWalletOrPubkey,
} from '@marinade.finance/cli-common'
import { Command } from 'commander'
import { setProgramIdByOwner } from '../../context'
import {
  ExecutionError,
  Wallet,
  executeTx,
  getVoteAccount,
  instanceOfWallet,
  transaction,
} from '@marinade.finance/web3js-common'
import {
  ValidatorBondsProgram,
  initBondInstruction,
} from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import { PublicKey, Signer } from '@solana/web3.js'
import { toBN } from '../../utils'
import { INIT_BOND_LIMIT_UNITS } from '../../computeUnits'
import BN from 'bn.js'
import { Logger } from 'pino'

export function configureInitBond(program: Command): Command {
  return program
    .command('init-bond')
    .description('Create a new bond account.')
    .requiredOption(
      '--vote-account <pubkey>',
      'Validator vote account that this bond is bound to',
      parsePubkey,
    )
    .option(
      '--validator-identity <keypair_or_ledger_or_pubkey>',
      'Validator identity linked to the vote account. ' +
        'Permission-ed execution requires the validator identity signature, possible possible to configure --bond-authority. ' +
        'Permission-less execution requires no signature, bond account configuration is possible later with validator identity signature (default: NONE)',
      parseWalletOrPubkey,
    )
    .option(
      '--bond-authority <pubkey>',
      'Authority that is permitted to operate with bond account. ' +
        'Only possible to set in permission-ed mode (see above, default: vote account validator identity)',
      parsePubkeyOrPubkeyFromWallet,
    )
    .option(
      '--rent-payer <keypair_or_ledger_or_pubkey>',
      'Rent payer for the account creation (default: wallet keypair)',
      parseWalletOrPubkey,
    )
    .option(
      '--cpmpe <number>',
      'Cost per mille per epoch, in lamports. The maximum amount of lamports the validator desires to pay for each 1000 delegated SOLs per epoch. (default: 0)',
      value => toBN(value),
    )
    .option(
      '--max-stake-wanted <number>',
      'The maximum stake amount, in lamports, that the validator wants to be delegated to them (default: 0).',
      value => toBN(value),
    )
}

export async function manageInitBond({
  config,
  voteAccount,
  validatorIdentity,
  bondAuthority,
  rentPayer,
  cpmpe,
  maxStakeWanted,
}: {
  config: PublicKey
  voteAccount: PublicKey
  validatorIdentity?: WalletInterface | PublicKey
  bondAuthority: PublicKey
  rentPayer?: WalletInterface | PublicKey
  cpmpe: BN
  maxStakeWanted: BN
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
  if (instanceOfWallet(validatorIdentity)) {
    signers.push(validatorIdentity)
    validatorIdentity = validatorIdentity.publicKey
  }

  if (bondAuthority === undefined) {
    // when not defined the bondAuthority is the validator identity
    const voteAccountData = await getVoteAccount(provider, voteAccount)
    bondAuthority = voteAccountData.account.data.nodePubkey
  }

  const { instruction, bondAccount } = await initBondInstruction({
    program,
    configAccount: config,
    bondAuthority,
    voteAccount,
    validatorIdentity,
    rentPayer,
    cpmpe,
    maxStakeWanted,
  })
  tx.add(instruction)

  logger.info(
    `Initializing bond account ${bondAccount.toBase58()} (finalization may take seconds)`,
  )

  try {
    await executeTx({
      connection: provider.connection,
      transaction: tx,
      errMessage:
        `'Failed to init bond account ${bondAccount.toBase58()}` +
        ` of config ${config.toBase58()}`,
      signers,
      logger,
      computeUnitLimit: INIT_BOND_LIMIT_UNITS,
      computeUnitPrice,
      simulate,
      printOnly,
      confirmOpts: confirmationFinality,
      confirmWaitTime,
      sendOpts: { skipPreflight },
    })
    logger.info(
      `Bond account ${bondAccount.toBase58()} of config ${config.toBase58()} successfully created`,
    )
  } catch (err) {
    await failIfUnexpectedError({
      err,
      logger,
      program,
      bondAccount,
    })
  }
}

async function failIfUnexpectedError({
  err,
  logger,
  program,
  bondAccount,
}: {
  err: unknown
  logger: Logger
  program: ValidatorBondsProgram
  bondAccount: PublicKey
}) {
  if (
    err instanceof ExecutionError &&
    err.messageWithCause().includes('custom program error: 0x0')
  ) {
    const bondData = await program.account.bond.fetchNullable(bondAccount)
    if (bondData !== null) {
      logger.info(
        `The bond account ${bondAccount.toBase58()} is ALREADY initialized.`,
      )
      return
    }
  }
  throw err
}
