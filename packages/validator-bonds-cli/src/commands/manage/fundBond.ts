import {
  parsePubkey,
  parsePubkeyOrPubkeyFromWallet,
  parseWalletOrPubkey,
} from '@marinade.finance/cli-common'
import { Command } from 'commander'
import { setProgramIdByOwner } from '../../context'
import {
  Provider,
  Wallet,
  executeTx,
  getStakeAccount,
  instanceOfWallet,
  transaction,
} from '@marinade.finance/web3js-common'
import {
  bondsWithdrawerAuthority,
  fundBondInstruction,
  MARINADE_CONFIG_ADDRESS,
} from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import { PublicKey, Signer } from '@solana/web3.js'
import { getBondFromAddress, isExpectedAnchorTransactionError } from '../utils'
import { FUND_BOND_LIMIT_UNITS } from '../../computeUnits'
import { Logger } from 'pino'

export function installFundBond(program: Command) {
  program
    .command('fund-bond')
    .description(
      'Funding a bond account with amount of SOL within a stake account.'
    )
    .argument(
      '<address>',
      'Address of the bond account or vote account.',
      parsePubkey
    )
    .option(
      '--config <pubkey>',
      'The config account that the bond account is created under ' +
        '(optional; to derive bond address from vote account address) ' +
        `(default: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
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
      parseWalletOrPubkey
    )
    .action(
      async (
        address: Promise<PublicKey>,
        {
          config,
          stakeAccount,
          stakeAuthority,
        }: {
          config?: Promise<PublicKey>
          stakeAccount: Promise<PublicKey>
          stakeAuthority?: Promise<WalletInterface | PublicKey>
        }
      ) => {
        await manageFundBond({
          address: await address,
          config: await config,
          stakeAccount: await stakeAccount,
          stakeAuthority: await stakeAuthority,
        })
      }
    )
}

async function manageFundBond({
  address,
  config,
  stakeAccount,
  stakeAuthority,
}: {
  address: PublicKey
  config?: PublicKey
  stakeAccount: PublicKey
  stakeAuthority?: WalletInterface | PublicKey
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
      computeUnitLimit: FUND_BOND_LIMIT_UNITS,
      computeUnitPrice,
      simulate,
      printOnly,
      confirmOpts: confirmationFinality,
      confirmWaitTime,
      sendOpts: { skipPreflight },
    })
  } catch (err) {
    return failIfUnexpectedError({
      err,
      logger,
      provider,
      config,
      programId,
      stakeAccount,
      bondAccount,
    })
  }
  logger.info(
    `Bond account ${bondAccount.toBase58()} successfully funded ` +
      `with stake account ${stakeAccount.toBase58()}`
  )
}

async function failIfUnexpectedError({
  err,
  logger,
  provider,
  config,
  programId,
  stakeAccount,
  bondAccount,
}: {
  err: unknown
  logger: Logger
  provider: Provider
  config: PublicKey
  programId: PublicKey | undefined
  stakeAccount: PublicKey
  bondAccount: PublicKey
}) {
  if (
    await isExpectedAnchorTransactionError(
      err,
      'wrong withdrawer authority of the stake account'
    )
  ) {
    // it could be already funded account, let's check it
    const [bondsWithdrawerAuth] = bondsWithdrawerAuthority(config, programId)
    const stakeAccountData = await getStakeAccount(
      provider.connection,
      stakeAccount
    )
    if (stakeAccountData.withdrawer?.equals(bondsWithdrawerAuth)) {
      logger.debug(
        `Bonds withdrawer authority '${bondsWithdrawerAuth.toBase58()}' for config '${config.toBase58()}' and program id '${programId?.toBase58()}'`
      )
      logger.info(
        `The stake account ${stakeAccount.toBase58()} is ALREADY funded ` +
          `to bond account ${bondAccount.toBase58()}.`
      )
      return
    }
  }
  throw err
}
