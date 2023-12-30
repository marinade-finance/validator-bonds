import { parsePubkey, parsePubkeyOrKeypair } from '@marinade.finance/cli-common'
import { Keypair, PublicKey, Signer } from '@solana/web3.js'
import { Command } from 'commander'
import { setProgramIdByOwner } from '../../context'
import { transaction } from '@marinade.finance/anchor-common'
import { Wallet, executeTx } from '@marinade.finance/web3js-common'
import {
  CONFIG_ADDRESS,
  configureConfigInstruction,
} from '@marinade.finance/validator-bonds-sdk'

export function installConfigureConfig(program: Command) {
  program
    .command('configure-config')
    .description('Configure existing config account.')
    .argument(
      '[config-account-address]',
      'Address of the validator bonds config account to configure ' +
        `(default: ${CONFIG_ADDRESS.toBase58()})`,
      parsePubkey
    )
    .option(
      '--admin-authority <keypair_or_pubkey>',
      'Admin authority that is permitted to do the configuration change (default: wallet)',
      parsePubkeyOrKeypair
    )
    .option(
      '--operator <pubkey>',
      'New operator authority to be configured',
      parsePubkey
    )
    .option(
      '--admin <pubkey>',
      'New admin authority to be configured',
      parsePubkey
    )
    .option(
      '--epochs-to-claim-settlement <number>',
      'New number of epochs after which claim can be settled',
      parseFloat
    )
    .option(
      '--withdraw-lockup-epochs <number>',
      'New number of epochs after which withdraw can be executed',
      parseFloat
    )
    .option(
      '--minimum-stake-lamports <number>',
      'New value of minimum stake lamports used when program do splitting of stake',
      parseFloat
    )
    .action(
      async (
        configAccountAddress: Promise<undefined | PublicKey>,
        {
          adminAuthority,
          admin,
          operator,
          epochsToClaimSettlement,
          withdrawLockupEpochs,
          minimumStakeLamports,
        }: {
          adminAuthority?: Promise<Keypair | PublicKey>
          admin?: Promise<PublicKey>
          operator?: Promise<PublicKey>
          rentPayer?: Promise<PublicKey | Keypair>
          epochsToClaimSettlement?: number
          withdrawLockupEpochs?: number
          minimumStakeLamports?: number
        }
      ) => {
        await manageConfigureConfig({
          address: await configAccountAddress,
          adminAuthority: await adminAuthority,
          admin: await admin,
          operator: await operator,
          epochsToClaimSettlement,
          withdrawLockupEpochs,
          minimumStakeLamports,
        })
      }
    )
}

async function manageConfigureConfig({
  address = CONFIG_ADDRESS,
  adminAuthority,
  admin,
  operator,
  epochsToClaimSettlement,
  withdrawLockupEpochs,
  minimumStakeLamports,
}: {
  address?: PublicKey
  adminAuthority?: Keypair | PublicKey
  admin?: PublicKey
  operator?: PublicKey
  epochsToClaimSettlement?: number
  withdrawLockupEpochs?: number
  minimumStakeLamports?: number
}) {
  const { program, provider, logger, simulate, printOnly, wallet } =
    await setProgramIdByOwner(address)

  const tx = await transaction(provider)
  const signers: (Signer | Wallet)[] = [wallet]

  adminAuthority = adminAuthority || wallet.publicKey
  if (adminAuthority instanceof Keypair) {
    signers.push(adminAuthority)
    adminAuthority = adminAuthority.publicKey
  }

  const { instruction } = await configureConfigInstruction({
    program,
    configAccount: address,
    adminAuthority,
    newAdmin: admin,
    newOperator: operator,
    newEpochsToClaimSettlement: epochsToClaimSettlement,
    newWithdrawLockupEpochs: withdrawLockupEpochs,
    newMinimumStakeLamports: minimumStakeLamports,
  })
  tx.add(instruction)

  await executeTx({
    connection: provider.connection,
    transaction: tx,
    errMessage: `'Failed to create config account ${address.toBase58()}`,
    signers,
    logger,
    simulate,
    printOnly,
  })
  logger.info(`Config account ${address.toBase58()} successfully configured`)
}
