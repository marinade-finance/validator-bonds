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
  newAuthority,
  newRevenueShare,
}: {
  program: ValidatorBondsProgram
  configAccount?: PublicKey
  validatorVoteAccount?: PublicKey
  bondAccount?: PublicKey
  authority?: PublicKey | Keypair | Signer // signer
  newAuthority?: PublicKey
  newRevenueShare?: BN | number
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
  authority = authority instanceof PublicKey ? authority : authority.publicKey

  if (newRevenueShare !== undefined) {
    newRevenueShare =
      newRevenueShare instanceof BN
        ? newRevenueShare.toNumber()
        : newRevenueShare
  }

  const instruction = await program.methods
    .configureBond({
      bondAuthority: newAuthority === undefined ? null : newAuthority,
      revenueShare:
        newRevenueShare === undefined
          ? null
          : { hundredthBps: newRevenueShare },
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
