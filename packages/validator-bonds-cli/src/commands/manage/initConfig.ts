import {
  computeUnitLimitOption,
  getCliContext,
} from '@marinade.finance/validator-bonds-cli-core'
import { INIT_CONFIG_LIMIT_UNITS } from '@marinade.finance/validator-bonds-cli-core'
import { initConfigInstruction } from '@marinade.finance/validator-bonds-sdk'
import {
  executeTx,
  instanceOfWallet,
  transaction,
  parseKeypair,
  parsePubkeyOrPubkeyFromWallet,
  parseWalletOrPubkeyOption,
} from '@marinade.finance/web3js-1x'
import { Keypair } from '@solana/web3.js'

import type { Wallet } from '@marinade.finance/web3js-1x'
import type { Wallet as WalletInterface } from '@marinade.finance/web3js-1x'
import type { PublicKey, Signer } from '@solana/web3.js'
import type { Command } from 'commander'

export function installInitConfig(program: Command) {
  program
    .command('init-config')
    .description('Create a new config account.')
    .option(
      '--address <keypair>',
      'Keypair of the new config account, when not set a random keypair is generated',
      parseKeypair,
    )
    .option(
      '--admin <pubkey>',
      'Admin authority to initialize the config account with (default: wallet pubkey)',
      parsePubkeyOrPubkeyFromWallet,
    )
    .option(
      '--operator <pubkey>',
      'Operator authority to initialize the config account with (default: admin authority)',
      parsePubkeyOrPubkeyFromWallet,
    )
    .option(
      '--rent-payer <keypair-or-ledger-or-pubkey>',
      'Rent payer for the account creation (default: wallet keypair)',
      parseWalletOrPubkeyOption,
    )
    .option(
      '--epochs-to-claim-settlement <number>',
      'number of epochs after which claim can be settled',
      v => parseInt(v, 10),
      3,
    )
    .option(
      '--withdraw-lockup-epochs <number>',
      'number of epochs after which withdraw can be executed',
      v => parseInt(v, 10),
      3,
    )
    .option(
      '--slots-to-start-settlement-claiming <number>',
      'number of slots after which settlement claim can be settled',
      v => parseInt(v, 10),
      0,
    )
    .addOption(computeUnitLimitOption(INIT_CONFIG_LIMIT_UNITS))
    .action(
      async ({
        address,
        admin,
        operator,
        rentPayer,
        epochsToClaimSettlement,
        slotsToStartSettlementClaiming,
        withdrawLockupEpochs,
        computeUnitLimit,
      }: {
        address?: Promise<Keypair>
        admin?: Promise<PublicKey>
        operator?: Promise<PublicKey>
        rentPayer?: Promise<WalletInterface | PublicKey>
        epochsToClaimSettlement: number
        slotsToStartSettlementClaiming: number
        withdrawLockupEpochs: number
        computeUnitLimit: number
      }) => {
        await manageInitConfig({
          address: await address,
          admin: await admin,
          operator: await operator,
          rentPayer: await rentPayer,
          epochsToClaimSettlement,
          slotsToStartSettlementClaiming,
          withdrawLockupEpochs,
          computeUnitLimit,
        })
      },
    )
}

async function manageInitConfig({
  address = Keypair.generate(),
  admin,
  operator,
  rentPayer,
  epochsToClaimSettlement,
  slotsToStartSettlementClaiming,
  withdrawLockupEpochs,
  computeUnitLimit,
}: {
  address?: Keypair
  admin?: PublicKey
  operator?: PublicKey
  rentPayer?: WalletInterface | PublicKey
  epochsToClaimSettlement: number
  slotsToStartSettlementClaiming: number
  withdrawLockupEpochs: number
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
  const signers: (Signer | Wallet)[] = [address, wallet]

  rentPayer = rentPayer ?? wallet.publicKey
  if (instanceOfWallet(rentPayer)) {
    signers.push(rentPayer)
    rentPayer = rentPayer.publicKey
  }

  admin = admin ?? wallet.publicKey
  operator = operator ?? admin

  const { instruction } = await initConfigInstruction({
    configAccount: address.publicKey,
    program,
    admin,
    operator,
    epochsToClaimSettlement,
    slotsToStartSettlementClaiming,
    withdrawLockupEpochs,
    rentPayer,
  })
  tx.add(instruction)

  await executeTx({
    connection: provider.connection,
    transaction: tx,
    errMessage: `'Failed to create config account ${address.publicKey.toBase58()}`,
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
    `Config account ${address.publicKey.toBase58()} successfully created`,
  )
}
