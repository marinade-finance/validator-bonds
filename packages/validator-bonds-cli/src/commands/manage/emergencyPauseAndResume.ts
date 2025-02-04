import { parsePubkey, parseWalletOrPubkey } from '@marinade.finance/cli-common'
import { PublicKey, Signer, TransactionInstruction } from '@solana/web3.js'
import { Command } from 'commander'
import { setProgramIdByOwner } from '@marinade.finance/validator-bonds-cli-core'
import {
  Wallet,
  executeTx,
  instanceOfWallet,
  transaction,
} from '@marinade.finance/web3js-common'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import {
  MARINADE_CONFIG_ADDRESS,
  emergencyPauseInstruction,
  emergencyResumeInstruction,
} from '@marinade.finance/validator-bonds-sdk'
import { EMERGENCY_LIMIT_UNITS } from '@marinade.finance/validator-bonds-cli-core'

export function installEmergencyPause(program: Command) {
  program
    .command('pause')
    .description('Pausing Validator Bond contract for config account')
    .argument(
      '[address]',
      'Address of the validator bonds config account to be paused ' +
        `(default: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
      parsePubkey,
    )
    .option(
      '--authority <keypair_or_ledger_or_pubkey>',
      'Pause authority with permission to pause the contract (default: wallet)',
      parseWalletOrPubkey,
    )
    .action(
      async (
        address: Promise<undefined | PublicKey>,
        {
          authority,
        }: {
          authority?: Promise<WalletInterface | PublicKey>
        },
      ) => {
        await manageEmergencyPauseAndResume({
          action: 'pause',
          address: (await address) ?? MARINADE_CONFIG_ADDRESS,
          authority: await authority,
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
      '--authority <keypair_or_ledger_or_pubkey>',
      'Pause authority with permission to resume the contract (default: wallet)',
      parseWalletOrPubkey,
    )
    .action(
      async (
        address: Promise<undefined | PublicKey>,
        {
          authority,
        }: {
          authority?: Promise<WalletInterface | PublicKey>
        },
      ) => {
        await manageEmergencyPauseAndResume({
          action: 'resume',
          address: (await address) ?? MARINADE_CONFIG_ADDRESS,
          authority: await authority,
        })
      },
    )
}

async function manageEmergencyPauseAndResume({
  action,
  address,
  authority,
}: {
  action: 'pause' | 'resume'
  address: PublicKey
  authority?: WalletInterface | PublicKey
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
  } = await setProgramIdByOwner(address)

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
    computeUnitLimit: EMERGENCY_LIMIT_UNITS,
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
