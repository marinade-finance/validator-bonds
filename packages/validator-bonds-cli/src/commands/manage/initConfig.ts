import { parseKeypair, parsePubkey } from '@marinade.finance/cli-common'
import { Keypair, PublicKey, Signer } from '@solana/web3.js'
import { Command } from 'commander'
import { getCliContext, parseSignerOrPubkey } from '../../context'
import { transaction } from '@marinade.finance/anchor-common'
import {
  Wallet,
  executeTx,
  instanceOfWallet,
} from '@marinade.finance/web3js-common'
import { initConfigInstruction } from '@marinade.finance/validator-bonds-sdk'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'

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
      parsePubkey
    )
    .option(
      '--operator <pubkey>',
      'Operator authority to initialize the config account with (default: admin authority)',
      parsePubkey
    )
    .option(
      '--rent-payer <keypair_or_ledger_or_pubkey>',
      'Rent payer for the account creation (default: wallet keypair)',
      parseSignerOrPubkey
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
  const { program, provider, logger, simulate, printOnly, wallet } =
    getCliContext()

  const tx = await transaction(provider)
  const signers: (Signer | Wallet)[] = [address, wallet]

  console.log('rent payer:1', rentPayer)
  rentPayer = rentPayer || wallet.publicKey
  console.log(
    'rent payer:2',
    rentPayer,
    instanceOfWallet(rentPayer),
    rentPayer instanceof Keypair,
    rentPayer instanceof PublicKey
  )
  if (instanceOfWallet(rentPayer)) {
    console.log('signature of the rent payer here....')
    signers.push(rentPayer)
    rentPayer = rentPayer.publicKey
  }

  admin = admin || wallet.publicKey
  operator = operator || admin

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
    simulate,
    printOnly,
  })
  logger.info(
    `Config account ${address.publicKey.toBase58()} successfully created`
  )
}
