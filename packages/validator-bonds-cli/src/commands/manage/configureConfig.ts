import {
  parsePubkey,
  parsePubkeyOrPubkeyFromWallet,
  parseWalletOrPubkey,
} from '@marinade.finance/cli-common'
import { PublicKey, Signer } from '@solana/web3.js'
import { Command } from 'commander'
import { setProgramIdByOwner } from '../../context'
import {
  Wallet,
  executeTx,
  instanceOfWallet,
  transaction,
} from '@marinade.finance/web3js-common'
import { Wallet as WalletInterface } from '@marinade.finance/web3js-common'
import {
  MARINADE_CONFIG_ADDRESS,
  configureConfigInstruction,
  getConfig,
} from '@marinade.finance/validator-bonds-sdk'
import { CONFIGURE_CONFIG_LIMIT_UNITS } from '../../computeUnits'
import BN from 'bn.js'

export function installConfigureConfig(program: Command) {
  program
    .command('configure-config')
    .description('Configure existing config account.')
    .argument(
      '[address]',
      'Address of the validator bonds config account ' +
        `(default: ${MARINADE_CONFIG_ADDRESS.toBase58()})`,
      parsePubkey
    )
    .option(
      '--admin-authority <keypair_or_ledger_or_pubkey>',
      'Admin authority that is permitted to do the configuration change (default: wallet)',
      parseWalletOrPubkey
    )
    .option(
      '--admin <pubkey>',
      'New admin authority to be configured',
      parsePubkeyOrPubkeyFromWallet
    )
    .option(
      '--operator <pubkey>',
      'New operator authority to be configured',
      parsePubkeyOrPubkeyFromWallet
    )
    .option(
      '--pause-authority <pubkey>',
      'New pause authority to be configured',
      parsePubkeyOrPubkeyFromWallet
    )
    .option(
      '--epochs-to-claim-settlement <number>',
      'New number of epochs after which claim can be settled',
      parseFloat
    )
    .option(
      '--slots-to-start-settlement-claiming <number>',
      'number of slots after which settlement claim can be settled',
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
      value => new BN(value, 10)
    )
    .option(
      '--min-bond-max-stake-wanted <number>',
      'New value of minimum for max-stake-wanted field, in lamports, configured by validators in bond.',
      value => new BN(value, 10)
    )
    .action(
      async (
        address: Promise<undefined | PublicKey>,
        {
          adminAuthority,
          admin,
          operator,
          pauseAuthority,
          epochsToClaimSettlement,
          slotsToStartSettlementClaiming,
          withdrawLockupEpochs,
          minimumStakeLamports,
          minBondMaxStakeWanted,
        }: {
          adminAuthority?: Promise<WalletInterface | PublicKey>
          admin?: Promise<PublicKey>
          operator?: Promise<PublicKey>
          pauseAuthority?: Promise<PublicKey>
          epochsToClaimSettlement?: number
          slotsToStartSettlementClaiming?: number
          withdrawLockupEpochs?: number
          minimumStakeLamports?: BN
          minBondMaxStakeWanted?: BN
        }
      ) => {
        await manageConfigureConfig({
          address: await address,
          adminAuthority: await adminAuthority,
          admin: await admin,
          operator: await operator,
          pauseAuthority: await pauseAuthority,
          epochsToClaimSettlement,
          slotsToStartSettlementClaiming,
          withdrawLockupEpochs,
          minimumStakeLamports,
          minBondMaxStakeWanted,
        })
      }
    )
}

async function manageConfigureConfig({
  address = MARINADE_CONFIG_ADDRESS,
  adminAuthority,
  admin,
  operator,
  pauseAuthority,
  epochsToClaimSettlement,
  slotsToStartSettlementClaiming,
  withdrawLockupEpochs,
  minimumStakeLamports,
  minBondMaxStakeWanted,
}: {
  address?: PublicKey
  adminAuthority?: WalletInterface | PublicKey
  admin?: PublicKey
  operator?: PublicKey
  pauseAuthority?: PublicKey
  epochsToClaimSettlement?: number
  slotsToStartSettlementClaiming?: number
  withdrawLockupEpochs?: number
  minimumStakeLamports?: BN
  minBondMaxStakeWanted?: BN
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

  if (adminAuthority === undefined) {
    const configAccount = await getConfig(program, address)
    adminAuthority = configAccount.adminAuthority
    if (!printOnly && !adminAuthority.equals(wallet.publicKey)) {
      throw new Error(
        'Current wallet does not have permission to configure the config account. ' +
          `Current admin authority: ${adminAuthority.toBase58()}`
      )
    }
  }
  if (instanceOfWallet(adminAuthority)) {
    signers.push(adminAuthority)
    adminAuthority = adminAuthority.publicKey
  }

  const { instruction } = await configureConfigInstruction({
    program,
    configAccount: address,
    adminAuthority,
    newAdmin: admin,
    newOperator: operator,
    newPauseAuthority: pauseAuthority,
    newEpochsToClaimSettlement: epochsToClaimSettlement,
    newSlotsToStartSettlementClaiming: slotsToStartSettlementClaiming,
    newWithdrawLockupEpochs: withdrawLockupEpochs,
    newMinimumStakeLamports: minimumStakeLamports,
    newMinBondMaxStakeWanted: minBondMaxStakeWanted,
  })
  tx.add(instruction)

  await executeTx({
    connection: provider.connection,
    transaction: tx,
    errMessage: `'Failed to create config account ${address.toBase58()}`,
    signers,
    logger,
    computeUnitLimit: CONFIGURE_CONFIG_LIMIT_UNITS,
    computeUnitPrice,
    simulate,
    printOnly,
    confirmOpts: confirmationFinality,
    confirmWaitTime,
    sendOpts: { skipPreflight },
  })
  logger.info(`Config account ${address.toBase58()} successfully configured`)
}
