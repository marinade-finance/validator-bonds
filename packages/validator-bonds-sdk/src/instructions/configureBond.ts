import {
  Keypair,
  PublicKey,
  Signer,
  TransactionInstruction,
} from '@solana/web3.js'
import { CONFIG_ADDRESS, ValidatorBondsProgram } from '../sdk'
import { checkAndGetBondAddress, walletPubkey } from '../utils'
import BN from 'bn.js'
import { getBond } from '../api'

export async function configureBondInstruction({
  program,
  configAccount = CONFIG_ADDRESS,
  validatorVoteAccount,
  bondAccount,
  authority = walletPubkey(program),
  bondAuthority,
  revenueShare,
}: {
  program: ValidatorBondsProgram
  configAccount?: PublicKey
  validatorVoteAccount?: PublicKey
  bondAccount?: PublicKey
  authority?: PublicKey | Keypair | Signer // signer
  bondAuthority?: PublicKey
  revenueShare?: BN | number
}): Promise<{
  instruction: TransactionInstruction
}> {
  bondAccount = checkAndGetBondAddress(
    bondAccount,
    configAccount,
    validatorVoteAccount,
    program.programId
  )
  if (validatorVoteAccount === undefined) {
    const bondData = await getBond(program, bondAccount)
    validatorVoteAccount = bondData.validatorVoteAccount
  }
  if (revenueShare !== undefined) {
    revenueShare =
      revenueShare instanceof BN ? revenueShare.toNumber() : revenueShare
  }
  authority = authority instanceof PublicKey ? authority : authority.publicKey

  const instruction = await program.methods
    .configureBond({
      bondAuthority: bondAuthority === undefined ? null : bondAuthority,
      revenueShare:
        revenueShare === undefined ? null : { hundredthBps: revenueShare },
    })
    .accounts({
      bond: bondAccount,
      authority,
      validatorVoteAccount,
    })
    .instruction()
  return {
    instruction,
  }
}
