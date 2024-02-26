import {
  Keypair,
  PublicKey,
  Signer,
  TransactionInstruction,
} from '@solana/web3.js'
import { ValidatorBondsProgram, bondMintAddress } from '../sdk'
import { checkAndGetBondAddress, anchorProgramWalletPubkey } from '../utils'
import { getBond } from '../api'
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import { getVoteAccount } from '../web3.js'
import { getAssociatedTokenAddressSync } from 'solana-spl-token-modern'

export async function mintBondInstruction({
  program,
  destinationAuthority,
  bondAccount,
  configAccount,
  voteAccount,
  rentPayer = anchorProgramWalletPubkey(program),
}: {
  program: ValidatorBondsProgram
  destinationAuthority?: PublicKey
  bondAccount?: PublicKey
  configAccount?: PublicKey
  voteAccount?: PublicKey
  rentPayer?: PublicKey | Keypair | Signer | WalletInterface // signer
}): Promise<{
  bondAccount: PublicKey
  bondMint: PublicKey
  associatedTokenAccount: PublicKey
  instruction: TransactionInstruction
}> {
  bondAccount = checkAndGetBondAddress(
    bondAccount,
    configAccount,
    voteAccount,
    program.programId
  )

  const renPayerPubkey =
    rentPayer instanceof PublicKey ? rentPayer : rentPayer.publicKey

  if (voteAccount === undefined) {
    const bondData = await getBond(program, bondAccount)
    voteAccount = bondData.voteAccount
  }
  // when destination is not defined, the destination is the vote account validator identity
  if (destinationAuthority === undefined) {
    const voteAccountData = await getVoteAccount(program, voteAccount)
    destinationAuthority = voteAccountData.account.data.nodePubkey
  }

  const [bondMint] = bondMintAddress(bondAccount, program.programId)
  const destinationTokenAccount = getAssociatedTokenAddressSync(
    bondMint,
    destinationAuthority,
    true
  )

  const instruction = await program.methods
    .mintBond()
    .accounts({
      bond: bondAccount,
      config: configAccount,
      voteAccount,
      mint: bondMint,
      destinationAuthority,
      destinationTokenAccount,
      rentPayer: renPayerPubkey,
    })
    .instruction()
  return {
    bondAccount,
    bondMint,
    associatedTokenAccount: destinationTokenAccount,
    instruction,
  }
}
