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
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'

export async function configureBondInstruction({
  program,
  bondAccount,
  configAccount = CONFIG_ADDRESS,
  validatorVoteAccount,
  authority = walletPubkey(program),
  newBondAuthority,
  newRevenueShareHundredthBps,
}: {
  program: ValidatorBondsProgram
  bondAccount?: PublicKey
  configAccount?: PublicKey
  validatorVoteAccount?: PublicKey
  authority?: PublicKey | Keypair | Signer | WalletInterface | WalletInterface // signer
  newBondAuthority?: PublicKey
  newRevenueShareHundredthBps?: BN | number
}): Promise<{
  bondAccount: PublicKey
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

  if (newRevenueShareHundredthBps !== undefined) {
    newRevenueShareHundredthBps =
      newRevenueShareHundredthBps instanceof BN
        ? newRevenueShareHundredthBps.toNumber()
        : newRevenueShareHundredthBps
  }

  const instruction = await program.methods
    .configureBond({
      bondAuthority: newBondAuthority === undefined ? null : newBondAuthority,
      revenueShare:
        newRevenueShareHundredthBps === undefined
          ? null
          : { hundredthBps: newRevenueShareHundredthBps },
    })
    .accounts({
      bond: bondAccount,
      authority,
      validatorVoteAccount,
    })
    .instruction()
  return {
    bondAccount,
    instruction,
  }
}
