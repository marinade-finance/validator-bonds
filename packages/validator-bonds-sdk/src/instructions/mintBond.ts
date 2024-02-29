import {
  Keypair,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  Signer,
  TransactionInstruction,
} from '@solana/web3.js'
import { ValidatorBondsProgram, bondMintAddress } from '../sdk'
import { checkAndGetBondAddress, anchorProgramWalletPubkey } from '../utils'
import { getBond } from '../api'
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import {
  getVoteAccount,
  MPL_TOKEN_METADATA_PROGRAM_ID,
  tokenMetadataAddress,
} from '../web3.js'
import { getAssociatedTokenAddressSync } from 'solana-spl-token-modern'

/**
 * Generate instruction to mint configuration bond token. Permission-less operation.
 * The token is minted either to validator identity pubkey or to withdrawer of vote account.
 */
export async function mintBondInstruction({
  program,
  destinationAuthority,
  bondAccount,
  configAccount,
  voteAccount,
  metadataAccount,
  rentPayer = anchorProgramWalletPubkey(program),
}: {
  program: ValidatorBondsProgram
  destinationAuthority?: PublicKey
  bondAccount?: PublicKey
  configAccount?: PublicKey
  voteAccount?: PublicKey
  metadataAccount?: PublicKey
  rentPayer?: PublicKey | Keypair | Signer | WalletInterface // signer
}): Promise<{
  bondAccount: PublicKey
  bondMint: PublicKey
  associatedTokenAccount: PublicKey
  tokenMetadataAccount: PublicKey
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

  if (metadataAccount === undefined) {
    ;[metadataAccount] = tokenMetadataAddress(bondMint)
  }

  const instruction = await program.methods
    .mintBond()
    .accounts({
      bond: bondAccount,
      config: configAccount,
      voteAccount,
      mint: bondMint,
      metadata: metadataAccount,
      destinationAuthority,
      destinationTokenAccount,
      rentPayer: renPayerPubkey,
      rent: SYSVAR_RENT_PUBKEY,
      metadataProgram: MPL_TOKEN_METADATA_PROGRAM_ID,
    })
    .instruction()
  return {
    bondAccount,
    bondMint,
    associatedTokenAccount: destinationTokenAccount,
    tokenMetadataAccount: metadataAccount,
    instruction,
  }
}
