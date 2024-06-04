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
} from '../sdk'
import { anchorProgramWalletPubkey } from '../utils'
import BN from 'bn.js'
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import { getBond, getSettlement } from '../api'
import { getStakeAccount } from '../web3.js'
import { MerkleTreeNode } from '../merkleTree'
import {getConcurrentMerkleTreeAccountSize, PROGRAM_ID as spl_account_compression_program_id} from '@solana/spl-account-compression'
import { Key } from 'readline'

/**
 * Generate instruction to claim from settlement protected event.
 * Permission-less operation. The legitimacy of the claim
 * is verified against the merkle proof and the merkle root.
 */
export async function claimSettlementInstruction({
  program,
  claimAmount,
  merkleProof,
  stakeAccountFrom,
  stakeAccountTo,
  stakeAccountStaker,
  stakeAccountWithdrawer,
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
  stakeAccountFrom: PublicKey
  stakeAccountTo: PublicKey
  stakeAccountWithdrawer?: PublicKey
  stakeAccountStaker?: PublicKey
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
  merkleTree: Keypair
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
    throw new Error(
      'Either [configAccount+voteAccount] or [bondAccount] must be provided'
    )
  }

  if (configAccount === undefined || voteAccount === undefined) {
    const bondData = await getBond(program, bondAccount)
    configAccount = configAccount || bondData.config
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

  if (
    stakeAccountStaker === undefined ||
    stakeAccountWithdrawer === undefined
  ) {
    const stakeAccountToData = await getStakeAccount(program, stakeAccountTo, 0)
    if (
      stakeAccountToData.staker === null ||
      stakeAccountToData.withdrawer === null
    ) {
      throw new Error(
        'stakeAccountTo must be activated with staker and withdrawer defined'
      )
    }
    stakeAccountStaker = stakeAccountStaker || stakeAccountToData.staker
    stakeAccountWithdrawer =
      stakeAccountWithdrawer || stakeAccountToData.withdrawer
  }

  const [settlementClaimAccount] = settlementClaimAddress(
    {
      settlement: settlementAccount,
      stakeAccountStaker,
      stakeAccountWithdrawer,
      claim: claimAmount,
    },
    program.programId
  )

  const treeNodeHash = MerkleTreeNode.hash({
    stakeAuthority: stakeAccountStaker,
    withdrawAuthority: stakeAccountWithdrawer,
    claim: claimAmount,
  }).words

  const requiredSpace = getConcurrentMerkleTreeAccountSize(
    3,8,
    0,
  );
  const merkleTree = Keypair.generate()

  const instruction = await program.methods
    .claimSettlement({
      proof: merkleProofNumbers,
      treeNodeHash,
      claim: new BN(claimAmount),
      stakeAccountStaker,
      stakeAccountWithdrawer,
      merkleTreeSize: new BN(requiredSpace),
    })
    .accounts({
      config: configAccount,
      bond: bondAccount,
      settlement: settlementAccount,
      settlementClaim: settlementClaimAccount,
      stakeAccountFrom,
      stakeAccountTo,
      rentPayer: renPayerPubkey,
      systemProgram: SystemProgram.programId,
      stakeHistory: SYSVAR_STAKE_HISTORY_PUBKEY,
      clock: SYSVAR_CLOCK_PUBKEY,
      stakeProgram: StakeProgram.programId,
      compressionProgram: spl_account_compression_program_id,
      noopProgram: new PublicKey("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV"),
      merkleTree: merkleTree.publicKey,
    })
    .instruction()
  return {
    instruction,
    settlementClaimAccount,
    settlementAccount,
    merkleTree
  }
}
