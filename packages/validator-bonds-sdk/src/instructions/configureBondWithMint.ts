import {
  Keypair,
  PublicKey,
  Signer,
  TransactionInstruction,
} from '@solana/web3.js'
import { ValidatorBondsProgram, bondMintAddress } from '../sdk'
import { checkAndGetBondAddress, anchorProgramWalletPubkey } from '../utils'
import BN from 'bn.js'
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import { getAssociatedTokenAddressSync } from 'solana-spl-token-modern'
import { getBond } from '../api'
import { getVoteAccount } from '@marinade.finance/web3js-common'

/**
 * Generate instruction to configure bond account with ownership of bond minted token.
 * Owner of the token has to sign the transaction and the token is burnt.
 */
export async function configureBondWithMintInstruction({
  program,
  bondAccount,
  configAccount,
  voteAccount,
  validatorIdentity,
  tokenAccount,
  tokenAuthority = anchorProgramWalletPubkey(program),
  newBondAuthority,
  newCpmpe,
}: {
  program: ValidatorBondsProgram
  bondAccount?: PublicKey
  configAccount?: PublicKey
  voteAccount?: PublicKey
  validatorIdentity?: PublicKey
  tokenAccount?: PublicKey
  tokenAuthority?:
    | PublicKey
    | Keypair
    | Signer
    | WalletInterface
    | WalletInterface // signer
  newBondAuthority?: PublicKey
  newCpmpe?: BN | number
}): Promise<{
  instruction: TransactionInstruction
  bondAccount: PublicKey
}> {
  bondAccount = checkAndGetBondAddress(
    bondAccount,
    configAccount,
    voteAccount,
    program.programId
  )
  if (configAccount === undefined || voteAccount === undefined) {
    const bondData = await getBond(program, bondAccount)
    configAccount = configAccount ?? bondData.config
    voteAccount = voteAccount ?? bondData.voteAccount
  }

  if (validatorIdentity === undefined) {
    const voteAccountData = await getVoteAccount(program, voteAccount)
    validatorIdentity = voteAccountData.account.data.nodePubkey
  }

  tokenAuthority =
    tokenAuthority instanceof PublicKey
      ? tokenAuthority
      : tokenAuthority.publicKey
  const [bondMint] = bondMintAddress(
    bondAccount,
    validatorIdentity,
    program.programId
  )
  if (tokenAccount === undefined) {
    tokenAccount = getAssociatedTokenAddressSync(bondMint, tokenAuthority, true)
  }

  const instruction = await program.methods
    .configureBondWithMint({
      validatorIdentity,
      bondAuthority: newBondAuthority === undefined ? null : newBondAuthority,
      cpmpe: newCpmpe === undefined ? null : new BN(newCpmpe),
    })
    .accounts({
      bond: bondAccount,
      config: configAccount,
      voteAccount,
      mint: bondMint,
      tokenAccount,
      tokenAuthority,
    })
    .instruction()
  return {
    instruction,
    bondAccount,
  }
}
