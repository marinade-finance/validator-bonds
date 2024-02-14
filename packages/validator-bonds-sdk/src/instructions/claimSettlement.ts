import {
  EpochInfo,
  Keypair,
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_STAKE_HISTORY_PUBKEY,
  Signer,
  StakeProgram,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  Settlement,
  ValidatorBondsProgram,
  bondAddress,
  settlementAddress,
  settlementClaimAddress,
  withdrawerAuthority,
} from '../sdk'
import { anchorProgramWalletPubkey } from '../utils'
import BN from 'bn.js'
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import { getBond, getSettlement } from '../api'

export async function claimSettlementInstruction({
  program,
  claimAmount,
  merkleProof,
  withdrawer,
  stakeAccount,
  settlementAccount,
  settlementMerkleRoot,
  settlementEpoch,
  configAccount,
  bondAccount,
  voteAccount,
  rentPayer = anchorProgramWalletPubkey(program),
}: {
  program: ValidatorBondsProgram
  claimAmount: number | BN
  merkleProof: (number[] | Uint8Array | Buffer)[]
  withdrawer: PublicKey
  stakeAccount: PublicKey
  settlementAccount?: PublicKey
  settlementMerkleRoot?: number[] | Uint8Array | Buffer
  settlementEpoch?: number | BN | EpochInfo
  configAccount?: PublicKey
  bondAccount?: PublicKey
  voteAccount?: PublicKey
  rentPayer?: PublicKey | Keypair | Signer | WalletInterface // signer
}): Promise<{
  instruction: TransactionInstruction
  settlementClaimAccount: PublicKey
  settlementAccount: PublicKey
}> {
  const renPayerPubkey =
    rentPayer instanceof PublicKey ? rentPayer : rentPayer.publicKey

  let settlementData: undefined | Settlement
  if (settlementAccount !== undefined) {
    settlementData = await getSettlement(program, settlementAccount)
    bondAccount = bondAccount || settlementData.bond
  }

  if (
    voteAccount !== undefined &&
    configAccount !== undefined &&
    bondAccount === undefined
  ) {
    ;[bondAccount] = bondAddress(configAccount, voteAccount, program.programId)
  }
  if (bondAccount === undefined) {
    throw new Error('Either voteAccount or bondAccount must be provided')
  }

  if (configAccount === undefined || voteAccount === undefined) {
    const bondData = await getBond(program, bondAccount)
    configAccount = configAccount || bondData.config
    voteAccount = voteAccount || bondData.voteAccount
  }

  if (
    settlementAccount === undefined &&
    settlementMerkleRoot !== undefined &&
    settlementEpoch !== undefined
  ) {
    ;[settlementAccount] = settlementAddress(
      bondAccount,
      settlementMerkleRoot,
      settlementEpoch,
      program.programId
    )
  }
  if (settlementAccount === undefined) {
    throw new Error(
      '[settlementAccount] must be provided or needed to have [bondAccount, merkleProof] to derive the address'
    )
  }

  const merkleProofNumbers = merkleProof.map(proofPathRecord => {
    if (Array.isArray(proofPathRecord)) {
      return proofPathRecord
    } else {
      return Array.from(proofPathRecord)
    }
  })
  const [bondsWithdrawerAuthority] = withdrawerAuthority(
    configAccount,
    program.programId
  )
  const [settlementClaimAccount] = settlementClaimAddress(
    {
      settlement: settlementAccount,
      stakeAuthority: bondsWithdrawerAuthority,
      voteAccount,
      withdrawAuthority: withdrawer,
      claim: claimAmount,
    },
    program.programId
  )

  const instruction = await program.methods
    .claimSettlement({
      proof: merkleProofNumbers,
      claim: new BN(claimAmount),
    })
    .accounts({
      withdrawAuthority: withdrawer,
      config: configAccount,
      bond: bondAccount,
      settlement: settlementAccount,
      settlementClaim: settlementClaimAccount,
      stakeAccount,
      rentPayer: renPayerPubkey,
      systemProgram: SystemProgram.programId,
      stakeHistory: SYSVAR_STAKE_HISTORY_PUBKEY,
      clock: SYSVAR_CLOCK_PUBKEY,
      stakeProgram: StakeProgram.programId,
    })
    .instruction()
  return {
    instruction,
    settlementClaimAccount,
    settlementAccount,
  }
}
