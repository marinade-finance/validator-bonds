import {
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_STAKE_HISTORY_PUBKEY,
  StakeProgram,
} from '@solana/web3.js'
import BN from 'bn.js'

import { getBond, getSettlement } from '../api'
import { MerkleTreeNode } from '../merkleTree'
import { bondAddress, settlementAddress, settlementClaimsAddress } from '../sdk'
import { getStakeAccount } from '../web3.js'

import type { Settlement, ValidatorBondsProgram } from '../sdk'
import type {
  EpochInfo,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js'

/**
 * Generate instruction to claim from settlement protected event.
 * Permission-less operation. The legitimacy of the claim
 * is verified against the merkle proof and the merkle root.
 */
export async function claimSettlementV2Instruction({
  program,
  claimAmount,
  index,
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
}: {
  program: ValidatorBondsProgram
  claimAmount: number | BN
  index: number | BN
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
}): Promise<{
  instruction: TransactionInstruction
  settlementAccount: PublicKey
  settlementClaimsAccount: PublicKey
}> {
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
      'Either [configAccount+voteAccount] or [bondAccount] must be provided',
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
      program.programId,
    )
  }
  if (settlementAccount === undefined) {
    throw new Error(
      '[settlementAccount] must be provided or needed to have [bondAccount, merkleProof] to derive the address',
    )
  }

  const [settlementClaimsAccount] = settlementClaimsAddress(
    settlementAccount,
    program.programId,
  )

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
        'stakeAccountTo must be activated with staker and withdrawer defined',
      )
    }
    stakeAccountStaker = stakeAccountStaker || stakeAccountToData.staker
    stakeAccountWithdrawer =
      stakeAccountWithdrawer || stakeAccountToData.withdrawer
  }

  const treeNodeHash = MerkleTreeNode.hash({
    stakeAuthority: stakeAccountStaker,
    withdrawAuthority: stakeAccountWithdrawer,
    claim: claimAmount,
    index,
  }).words

  const instruction = await program.methods
    .claimSettlementV2({
      proof: merkleProofNumbers,
      treeNodeHash,
      claim: new BN(claimAmount),
      stakeAccountStaker,
      stakeAccountWithdrawer,
      index: new BN(index),
    })
    .accounts({
      config: configAccount,
      bond: bondAccount,
      settlement: settlementAccount,
      settlementClaims: settlementClaimsAccount,
      stakeAccountFrom,
      stakeAccountTo,
      stakeHistory: SYSVAR_STAKE_HISTORY_PUBKEY,
      clock: SYSVAR_CLOCK_PUBKEY,
      stakeProgram: StakeProgram.programId,
    })
    .instruction()
  return {
    instruction,
    settlementAccount,
    settlementClaimsAccount,
  }
}
