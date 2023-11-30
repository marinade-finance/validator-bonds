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
  admin,
  operator,
  epochsToClaimSettlement,
  withdrawLockupEpochs,
  minimumStakeLamports,
}: {
  program: ValidatorBondsProgram
  configAccount?: PublicKey
  adminAuthority?: PublicKey | Keypair | Signer // signer
  admin?: PublicKey
  operator?: PublicKey
  epochsToClaimSettlement?: BN | number
  withdrawLockupEpochs?: BN | number
  minimumStakeLamports?: BN | number
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
    admin: admin || null,
    operator: operator || null,
    epochsToClaimSettlement: epochsToClaimSettlement
      ? new BN(epochsToClaimSettlement)
      : null,
    withdrawLockupEpochs: withdrawLockupEpochs
      ? new BN(withdrawLockupEpochs)
      : null,
    minimumStakeLamports: minimumStakeLamports
      ? new BN(minimumStakeLamports)
      : null,
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
