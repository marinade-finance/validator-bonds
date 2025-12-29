import {
  computeUnitLimitOption,
  getCliContext,
} from '@marinade.finance/validator-bonds-cli-core'
import { EMERGENCY_LIMIT_UNITS } from '@marinade.finance/validator-bonds-cli-core'
import {
  MARINADE_CONFIG_ADDRESS,
  emergencyPauseInstruction,
  emergencyResumeInstruction,
} from '@marinade.finance/validator-bonds-sdk'
import {
  executeTx,
  instanceOfWallet,
  parsePubkey,
  parseWalletOrPubkeyOption,
  transaction,
} from '@marinade.finance/web3js-1x'

import type {
  Wallet as WalletInterface,
  Wallet,
} from '@marinade.finance/web3js-1x'
import type { PublicKey, Signer, TransactionInstruction } from '@solana/web3.js'
import type { Command } from 'commander'

export function installEmergencyPause(program: Command) {
  program
    .command('pause')
    .description('Pausing Validator Bond contract for config account')
    .argument(
      '[config-address]',
      'Address of the validator bonds config account to be paused ' +
        `(default: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
      parsePubkey,
    )
    .option(
      '--authority <keypair-or-ledger-or-pubkey>',
      'Pause authority with permission to pause the contract (default: wallet)',
      parseWalletOrPubkeyOption,
    )
    .addOption(computeUnitLimitOption(EMERGENCY_LIMIT_UNITS))
    .action(
      async (
        address: Promise<undefined | PublicKey>,
        {
          authority,
          computeUnitLimit,
        }: {
          authority?: Promise<WalletInterface | PublicKey>
          computeUnitLimit: number
        },
      ) => {
        await manageEmergencyPauseAndResume({
          action: 'pause',
          address: (await address) ?? MARINADE_CONFIG_ADDRESS,
          authority: await authority,
          computeUnitLimit,
        })
      },
    )
}

export function installEmergencyResume(program: Command) {
  program
    .command('resume')
    .description('Resuming Validator Bond contract for config account')
    .argument(
      '[address]',
      'Address of the validator bonds config account to be resumed ' +
        `(default: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
      parsePubkey,
    )
    .option(
      '--authority <keypair-or-ledger-or-pubkey>',
      'Pause authority with permission to resume the contract (default: wallet)',
      parseWalletOrPubkeyOption,
    )
    .addOption(computeUnitLimitOption(EMERGENCY_LIMIT_UNITS))
    .action(
      async (
        address: Promise<undefined | PublicKey>,
        {
          authority,
          computeUnitLimit,
        }: {
          authority?: Promise<WalletInterface | PublicKey>
          computeUnitLimit: number
        },
      ) => {
        await manageEmergencyPauseAndResume({
          action: 'resume',
          address: (await address) ?? MARINADE_CONFIG_ADDRESS,
          authority: await authority,
          computeUnitLimit,
        })
      },
    )
}

async function manageEmergencyPauseAndResume({
  action,
  address,
  authority,
  computeUnitLimit,
}: {
  action: 'pause' | 'resume'
  address: PublicKey
  authority?: WalletInterface | PublicKey
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

  authority = authority ?? wallet.publicKey
  if (instanceOfWallet(authority)) {
    signers.push(authority)
    authority = authority.publicKey
  }

  let instruction: TransactionInstruction
  if (action === 'pause') {
    ;({ instruction } = await emergencyPauseInstruction({
      program,
      configAccount: address,
      pauseAuthority: authority,
      logger,
    }))
  } else {
    ;({ instruction } = await emergencyResumeInstruction({
      program,
      configAccount: address,
      pauseAuthority: authority,
      logger,
    }))
  }
  tx.add(instruction)

  await executeTx({
    connection: provider.connection,
    transaction: tx,
    errMessage: `'Failed to ${action} validator bonds contract config account ${address.toBase58()}`,
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
    `Succeeded to ${action} validator bonds config account ${address.toBase58()}`,
  )
}
