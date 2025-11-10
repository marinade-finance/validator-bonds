import { getVoteAccount } from '@marinade.finance/web3js-1x'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'
import { getAssociatedTokenAddressSync } from 'solana-spl-token-modern'

import { getBond } from '../api'
import { bondMintAddress } from '../sdk'
import { anchorProgramWalletPubkey, checkAndGetBondAddress } from '../utils'

import type { ValidatorBondsProgram } from '../sdk'
import type { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import type { Keypair, Signer, TransactionInstruction } from '@solana/web3.js'

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
  newMaxStakeWanted,
}: {
  program: ValidatorBondsProgram
  bondAccount?: PublicKey
  configAccount?: PublicKey
  voteAccount?: PublicKey
  validatorIdentity?: PublicKey
  tokenAccount?: PublicKey
  // signer
  tokenAuthority?: PublicKey | Keypair | Signer | WalletInterface
  newBondAuthority?: PublicKey
  newCpmpe?: BN | number
  newMaxStakeWanted?: BN | number
}): Promise<{
  instruction: TransactionInstruction
  bondAccount: PublicKey
}> {
  bondAccount = checkAndGetBondAddress({
    bond: bondAccount,
    config: configAccount,
    voteAccount,
    programId: program.programId,
  })
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
    program.programId,
  )
  if (tokenAccount === undefined) {
    tokenAccount = getAssociatedTokenAddressSync(bondMint, tokenAuthority, true)
  }

  const instruction = await program.methods
    .configureBondWithMint({
      validatorIdentity,
      bondAuthority: newBondAuthority === undefined ? null : newBondAuthority,
      cpmpe: newCpmpe === undefined ? null : new BN(newCpmpe),
      maxStakeWanted:
        newMaxStakeWanted === undefined ? null : new BN(newMaxStakeWanted),
    })
    .accountsPartial({
      bond: bondAccount,
      config: configAccount,
      voteAccount,
      mint: bondMint,
      tokenAccount,
      tokenAuthority,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction()
  return {
    instruction,
    bondAccount,
  }
}
