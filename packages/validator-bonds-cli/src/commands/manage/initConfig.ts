import {
  parseKeypair,
  parsePubkey,
  parsePubkeyOrKeypair,
} from '@marinade.finance/cli-common'
import { Keypair, PublicKey, Signer } from '@solana/web3.js'
import { Command } from 'commander'
import { getCliContext } from '../../context'
import { transaction } from '@marinade.finance/anchor-common'
import { Wallet, executeTx } from '@marinade.finance/web3js-common'
import { initConfigInstruction } from '@marinade.finance/validator-bonds-sdk'

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
      '--rent-payer <keypair_or_pubkey>',
      'Rent payer for the account creation (default: wallet keypair)',
      parsePubkeyOrKeypair
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
        rentPayer?: Promise<PublicKey | Keypair>
        epochsToClaimSettlement: number
        withdrawLockupEpochs: number
      }) => {
        await manageInitConfig({
          address: await address,
          adminAuthority: await admin,
          operatorAuthority: await operator,
          rentPayer: await rentPayer,
          epochsToClaimSettlement,
          withdrawLockupEpochs,
        })
      }
    )
}

async function manageInitConfig({
  address = Keypair.generate(),
  adminAuthority,
  operatorAuthority,
  rentPayer,
  epochsToClaimSettlement,
  withdrawLockupEpochs,
}: {
  address?: Keypair
  adminAuthority?: PublicKey
  operatorAuthority?: PublicKey
  rentPayer?: PublicKey | Keypair
  epochsToClaimSettlement: number
  withdrawLockupEpochs: number
}) {
  const { program, provider, logger, simulate, printOnly, wallet } =
    getCliContext()

  const tx = await transaction(provider)
  const signers: (Signer | Wallet)[] = [address, wallet]

  rentPayer = rentPayer || wallet.publicKey
  if (rentPayer instanceof Keypair) {
    signers.push(rentPayer)
    rentPayer = rentPayer.publicKey
  }

  adminAuthority = adminAuthority || wallet.publicKey
  operatorAuthority = operatorAuthority || adminAuthority

  const { instruction } = await initConfigInstruction({
    configAccount: address.publicKey,
    program,
    adminAuthority,
    operatorAuthority,
    epochsToClaimSettlement,
    withdrawLockupEpochs,
    rentPayer,
  })
  console.dir(instruction)
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
