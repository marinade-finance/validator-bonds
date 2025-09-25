import { logWarn } from '@marinade.finance/ts-common'
import { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'

import { getConfig } from '../api'
import { MARINADE_CONFIG_ADDRESS } from '../sdk'

import type { ConfigureConfigArgs, ValidatorBondsProgram } from '../sdk'
import type { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import type { LoggerPlaceholder } from '@marinade.finance/ts-common'
import type { Keypair, Signer, TransactionInstruction } from '@solana/web3.js'

/**
 * Generate instruction to configure config account. Available for admin authority.
 *
 * @type {Object} args - Arguments on instruction creation
 * @param param {ValidatorBondsProgram} args.program - anchor program instance
 * @param param {PublicKey} args.configAccount - config account to configure (default: MARINADE config address)
 * @param param {PublicKey} args.adminAuthority [SIGNER] - admin authority (default: provider wallet address)
 * @param param {PublicKey} args.newAdmin - admin authority that will be set when field is used
 * @param param {PublicKey} args.newOperator - operator authority that will be set when field is used
 * @param param {PublicKey} args.newPauseAuthority - pause authority that will be set when field is used
 * @param param {PublicKey} args.newEpochsToClaimSettlement - number of epochs before settlement claiming timeouts that will be set when field is used
 * @param param {PublicKey} args.newSlotsToStartSettlementClaiming - number of slots that has to expire until when settlement can be claimed
 * @param param {PublicKey} args.newWithdrawLockupEpochs - number of epochs after which withdraw can be executed that will be set when field is used
 * @param param {PublicKey} args.newMinimumStakeLamports - number of lamports as minimum stake account size that will be set when field is used
 * @type {Object} return - Return data of generated instruction
 * @return {TransactionInstruction} return.instruction - Instruction to configure config
 */
export async function configureConfigInstruction({
  program,
  configAccount,
  adminAuthority,
  newAdmin,
  newOperator,
  newPauseAuthority,
  newEpochsToClaimSettlement,
  newSlotsToStartSettlementClaiming,
  newWithdrawLockupEpochs,
  newMinimumStakeLamports,
  newMinBondMaxStakeWanted,
  logger,
}: {
  program: ValidatorBondsProgram
  configAccount?: PublicKey
  adminAuthority?: PublicKey | Keypair | Signer | WalletInterface // signer
  newAdmin?: PublicKey
  newOperator?: PublicKey
  newPauseAuthority?: PublicKey
  newEpochsToClaimSettlement?: BN | number
  newSlotsToStartSettlementClaiming?: BN | number
  newWithdrawLockupEpochs?: BN | number
  newMinimumStakeLamports?: BN | number
  newMinBondMaxStakeWanted?: BN | number
  logger?: LoggerPlaceholder
}): Promise<{
  instruction: TransactionInstruction
}> {
  if (adminAuthority === undefined) {
    if (configAccount === undefined) {
      logWarn(
        logger,
        'configureConfig SDK: config is not provided, using default config address: ' +
          MARINADE_CONFIG_ADDRESS.toBase58()
      )
      configAccount = MARINADE_CONFIG_ADDRESS
    }
    const configData = await getConfig(program, configAccount)
    adminAuthority = configData.adminAuthority
  }
  adminAuthority =
    adminAuthority instanceof PublicKey
      ? adminAuthority
      : adminAuthority.publicKey

  const args: ConfigureConfigArgs = {
    admin: newAdmin ?? null,
    operator: newOperator ?? null,
    pauseAuthority: newPauseAuthority ?? null,
    epochsToClaimSettlement: newEpochsToClaimSettlement
      ? new BN(newEpochsToClaimSettlement)
      : null,
    slotsToStartSettlementClaiming:
      newSlotsToStartSettlementClaiming !== undefined
        ? new BN(newSlotsToStartSettlementClaiming)
        : null,
    withdrawLockupEpochs:
      newWithdrawLockupEpochs !== undefined
        ? new BN(newWithdrawLockupEpochs)
        : null,
    minimumStakeLamports:
      newMinimumStakeLamports !== undefined
        ? new BN(newMinimumStakeLamports)
        : null,
    minBondMaxStakeWanted:
      newMinBondMaxStakeWanted !== undefined
        ? new BN(newMinBondMaxStakeWanted)
        : null,
  }

  if (Object.values(args).every(v => v === null)) {
    throw new Error(
      'configureConfigInstruction: method parameters provided no new property to configure'
    )
  }

  const instruction = await program.methods
    .configureConfig(args)
    .accounts({
      adminAuthority,
      config: configAccount,
    })
    .instruction()
  return {
    instruction,
  }
}
