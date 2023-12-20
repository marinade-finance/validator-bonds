import {
  Keypair,
  PublicKey,
  Signer,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  CONFIG_ADDRESS,
  ConfigureConfigArgs,
  ValidatorBondsProgram,
} from '../sdk'
import BN from 'bn.js'
import { getConfig } from '../api'

export async function configureConfigInstruction({
  program,
  configAccount = CONFIG_ADDRESS,
  adminAuthority,
  newAdmin,
  newOperator,
  newEpochsToClaimSettlement,
  newWithdrawLockupEpochs,
  newMinimumStakeLamports,
}: {
  program: ValidatorBondsProgram
  configAccount?: PublicKey
  adminAuthority?: PublicKey | Keypair | Signer // signer
  newAdmin?: PublicKey
  newOperator?: PublicKey
  newEpochsToClaimSettlement?: BN | number
  newWithdrawLockupEpochs?: BN | number
  newMinimumStakeLamports?: BN | number
}): Promise<{
  instruction: TransactionInstruction
}> {
  if (adminAuthority === undefined) {
    const configData = await getConfig(program, configAccount)
    adminAuthority = configData.adminAuthority
  }
  adminAuthority =
    adminAuthority instanceof PublicKey
      ? adminAuthority
      : adminAuthority.publicKey

  const args: ConfigureConfigArgs = {
    admin: newAdmin || null,
    operator: newOperator || null,
    epochsToClaimSettlement: newEpochsToClaimSettlement
      ? new BN(newEpochsToClaimSettlement)
      : null,
    withdrawLockupEpochs: newWithdrawLockupEpochs
      ? new BN(newWithdrawLockupEpochs)
      : null,
    minimumStakeLamports: newMinimumStakeLamports
      ? new BN(newMinimumStakeLamports)
      : null,
  }

  if (Object.values(args).every(v => v === null)) {
    throw new Error('No new config values provided')
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
