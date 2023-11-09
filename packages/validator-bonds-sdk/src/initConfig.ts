import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js'
import { ValidatorBondsProgram } from './sdk'
import BN from 'bn.js'

/**
 * Generate instruction to init config root account.
 *
 * @type {Object} args - Arguments on instruction creation
 * @param param {ValidatorBondsProgram} args.program - anchor program instance
 * @param param {PublicKey} args.configAccount - new config account address [SIGNER] (when not provided, it will be generated)
 * @param param {PublicKey} args.adminAuthority - admin authority (default: provider wallet address)
 * @param param {PublicKey} args.operatorAuthority - operator authority (default: adminAuthority)
 * @param param {PublicKey} args.rentPayer - rent exception payer [SIGNER] (default: provider wallet address)
 * @param param {PublicKey} args.claimSettlementAfterEpochs - number of epochs after which claim can be settled (default: 0)
 * @param param {PublicKey} args.withdrawLockupEpochs - number of epochs after which withdraw can be executed (default: 0)
 * @type {Object} return - Return data of generated instruction
 * @return {TransactionInstruction} return.instruction - Instruction to init config
 * @return {Keypair|PublicKey} return.keypair - keypair of new account (when generated)
 */
export async function initConfigInstruction({
  program,
  configAccount = Keypair.generate(),
  adminAuthority = program.provider.publicKey!,
  operatorAuthority = adminAuthority,
  rentPayer = program.provider.publicKey!,
  epochsToClaimSettlement = 0,
  withdrawLockupEpochs = 0,
}: {
  program: ValidatorBondsProgram
  configAccount?: PublicKey | Keypair // signer
  adminAuthority?: PublicKey
  operatorAuthority?: PublicKey
  rentPayer?: PublicKey // signer
  epochsToClaimSettlement?: BN | number
  withdrawLockupEpochs?: BN | number
}): Promise<{
  keypair: Keypair | undefined
  instruction: TransactionInstruction
}> {
  const configAccountAddress =
    configAccount instanceof Keypair ? configAccount.publicKey : configAccount

  const instruction = await program.methods
    .initConfig({
      adminAuthority,
      operatorAuthority,
      epochsToClaimSettlement: new BN(epochsToClaimSettlement),
      withdrawLockupEpochs: new BN(withdrawLockupEpochs),
    })
    .accountsStrict({
      config: configAccountAddress,
      rentPayer,
      systemProgram: SystemProgram.programId,
    })
    .instruction()
  return {
    keypair: configAccount instanceof Keypair ? configAccount : undefined,
    instruction,
  }
}
