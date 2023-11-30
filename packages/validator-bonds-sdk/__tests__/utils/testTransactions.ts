import { ValidatorBondsProgram, initConfigInstruction } from '../../src'
import { Keypair, PublicKey } from '@solana/web3.js'
import { pubkey, signer } from './helpers'
import { ExtendedProvider } from './provider'

export async function executeInitConfigInstruction(
  program: ValidatorBondsProgram,
  provider: ExtendedProvider,
  epochsToClaimSettlement: number = Math.floor(Math.random() * 10) + 1,
  withdrawLockupEpochs: number = Math.floor(Math.random() * 10) + 1
): Promise<{
  configAccount: PublicKey
  adminAuthority: Keypair
  operatorAuthority: Keypair
}> {
  const adminAuthority = Keypair.generate()
  const operatorAuthority = Keypair.generate()
  expect(adminAuthority).not.toEqual(operatorAuthority)

  const { configAccount, instruction } = await initConfigInstruction({
    program,
    adminAuthority: adminAuthority.publicKey,
    operatorAuthority: operatorAuthority.publicKey,
    epochsToClaimSettlement,
    withdrawLockupEpochs,
  })
  const signerConfigAccount = signer(configAccount)
  await provider.sendIx([signerConfigAccount], instruction)

  return {
    configAccount: pubkey(configAccount),
    adminAuthority,
    operatorAuthority,
  }
}
