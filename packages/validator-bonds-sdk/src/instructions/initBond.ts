import {
  Keypair,
  PublicKey,
  Signer,
  TransactionInstruction,
} from '@solana/web3.js'
import { CONFIG_ADDRESS, ValidatorBondsProgram, bondAddress } from '../sdk'
import { anchorProgramWalletPubkey } from '../utils'
import BN from 'bn.js'
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'

export async function initBondInstruction({
  program,
  configAccount = CONFIG_ADDRESS,
  voteAccount,
  validatorIdentity,
  bondAuthority = anchorProgramWalletPubkey(program),
  cpmpe = 0,
  rentPayer = anchorProgramWalletPubkey(program),
}: {
  program: ValidatorBondsProgram
  configAccount: PublicKey
  voteAccount: PublicKey
  validatorIdentity?: PublicKey | Keypair | Signer | WalletInterface // signer
  bondAuthority?: PublicKey
  cpmpe?: BN | number
  rentPayer?: PublicKey | Keypair | Signer | WalletInterface // signer
}): Promise<{
  instruction: TransactionInstruction
  bondAccount: PublicKey
}> {
  if (validatorIdentity !== undefined) {
    validatorIdentity =
      validatorIdentity instanceof PublicKey
        ? validatorIdentity
        : validatorIdentity.publicKey
  }
  const renPayerPubkey =
    rentPayer instanceof PublicKey ? rentPayer : rentPayer.publicKey
  const [bondAccount] = bondAddress(
    configAccount,
    voteAccount,
    program.programId
  )

  const instruction = await program.methods
    .initBond({
      bondAuthority,
      cpmpe: new BN(cpmpe),
    })
    .accounts({
      config: configAccount,
      bond: bondAccount,
      voteAccount,
      validatorIdentity: validatorIdentity ?? null,
      rentPayer: renPayerPubkey,
    })
    .instruction()
  return {
    bondAccount,
    instruction,
  }
}
