import {
  parseKeypair,
  parsePubkeyOrPubkeyFromWallet,
  parseWalletOrPubkey,
} from '@marinade.finance/cli-common'
import { Keypair, PublicKey, Signer } from '@solana/web3.js'
import { Command } from 'commander'
import { getCliContext } from '../../context'
import {
  Wallet,
  executeTx,
  instanceOfWallet,
  transaction,
} from '@marinade.finance/web3js-common'
import { initConfigInstruction } from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import { INIT_CONFIG_LIMIT_UNITS } from '../../computeUnits'

export function installInitConfig(program: Command) {
  program
    .command('init-config')
    .description('Create a new config account.')
    .option(
      '--address <keypair>',
      'Keypair of the new config account, when not set a random keypair is generated',
      parseKeypair
    )
    .option(
      '--admin <pubkey>',
      'Admin authority to initialize the config account with (default: wallet pubkey)',
      parsePubkeyOrPubkeyFromWallet
    )
    .option(
      '--operator <pubkey>',
      'Operator authority to initialize the config account with (default: admin authority)',
      parsePubkeyOrPubkeyFromWallet
    )
    .option(
      '--rent-payer <keypair_or_ledger_or_pubkey>',
      'Rent payer for the account creation (default: wallet keypair)',
      parseWalletOrPubkey
    )
    .option(
      '--epochs-to-claim-settlement <number>',
      'number of epochs after which claim can be settled',
      parseFloat,
      3
    )
    .option(
      '--withdraw-lockup-epochs <number>',
      'number of epochs after which withdraw can be executed',
      parseFloat,
      3
    )
    .action(
      async ({
        address,
        admin,
        operator,
        rentPayer,
        epochsToClaimSettlement,
        withdrawLockupEpochs,
      }: {
        address?: Promise<Keypair>
        admin?: Promise<PublicKey>
        operator?: Promise<PublicKey>
        rentPayer?: Promise<WalletInterface | PublicKey>
        epochsToClaimSettlement: number
        withdrawLockupEpochs: number
      }) => {
        await manageInitConfig({
          address: await address,
          admin: await admin,
          operator: await operator,
          rentPayer: await rentPayer,
          epochsToClaimSettlement,
          withdrawLockupEpochs,
        })
      }
    )
}

async function manageInitConfig({
  address = Keypair.generate(),
  admin,
  operator,
  rentPayer,
  epochsToClaimSettlement,
  withdrawLockupEpochs,
}: {
  address?: Keypair
  admin?: PublicKey
  operator?: PublicKey
  rentPayer?: WalletInterface | PublicKey
  epochsToClaimSettlement: number
  withdrawLockupEpochs: number
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
    computeUnitLimit: INIT_CONFIG_LIMIT_UNITS,
    computeUnitPrice,
    simulate,
    printOnly,
    confirmOpts: confirmationFinality,
  })
  logger.info(
    `Config account ${address.publicKey.toBase58()} successfully created`
  )
}
