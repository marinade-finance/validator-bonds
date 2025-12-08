import { logInfo } from '@marinade.finance/ts-common'
import {
  initBondInstruction,
  initCommissionProductInstruction,
} from '@marinade.finance/validator-bonds-sdk'
import {
  ExecutionError,
  executeTx,
  getVoteAccount,
  instanceOfWallet,
  parsePubkey,
  parsePubkeyOrPubkeyFromWallet,
  parseWalletOrPubkeyOption,
  transaction,
} from '@marinade.finance/web3js-1x'

import {
  INIT_BOND_CONFIG_COMMISSION_LIMIT_UNITS,
  INIT_BOND_LIMIT_UNITS,
  computeUnitLimitOption,
} from '../../computeUnits'
import { getCliContext } from '../../context'

import type { LoggerPlaceholder } from '@marinade.finance/ts-common'
import type { ValidatorBondsProgram } from '@marinade.finance/validator-bonds-sdk'
import type {
  Wallet as WalletInterface,
  Wallet,
} from '@marinade.finance/web3js-1x'
import type { PublicKey, Signer } from '@solana/web3.js'
import type BN from 'bn.js'
import type { Command } from 'commander'

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
      parseWalletOrPubkeyOption,
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
      parseWalletOrPubkeyOption,
    )
    .addOption(
      computeUnitLimitOption(
        INIT_BOND_LIMIT_UNITS + INIT_BOND_CONFIG_COMMISSION_LIMIT_UNITS,
      ),
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
  mevBps,
  blockBps,
  inflationBps,
  uniformBps,
  computeUnitLimit,
}: {
  config: PublicKey
  voteAccount: PublicKey
  validatorIdentity?: WalletInterface | PublicKey
  bondAuthority: PublicKey
  rentPayer?: WalletInterface | PublicKey
  cpmpe: BN
  maxStakeWanted: BN
  mevBps?: BN | null
  blockBps?: BN | null
  inflationBps?: BN | null
  uniformBps?: BN | null
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

  const { instruction: commissionInstruction, bondProduct } =
    await initCommissionProductInstruction({
      program,
      configAccount: config,
      bondAccount,
      voteAccount,
      authority: validatorIdentity,
      blockBps: blockBps ?? null,
      inflationBps: inflationBps ?? null,
      mevBps: mevBps ?? null,
      uniformBps,
      rentPayer,
    })
  tx.add(commissionInstruction)

  logger.info(
    `Initializing bond account ${bondAccount.toBase58()} (finalization may take seconds)`,
  )
  logger.debug(`Commission bond account: ${bondProduct.toBase58()}`)

  try {
    await executeTx({
      connection: provider.connection,
      transaction: tx,
      errMessage:
        `'Failed to init bond account ${bondAccount.toBase58()}` +
        ` of config ${config.toBase58()}`,
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
  logger: LoggerPlaceholder
  program: ValidatorBondsProgram
  bondAccount: PublicKey
}) {
  if (
    err instanceof ExecutionError &&
    err.messageWithCause().includes('custom program error: 0x0')
  ) {
    const bondData = await program.account.bond.fetchNullable(bondAccount)
    if (bondData !== null) {
      logInfo(
        logger,
        `The bond account ${bondAccount.toBase58()} is ALREADY initialized.`,
      )
      return
    }
  }
  throw err
}
