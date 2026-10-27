import { sha256 } from '@noble/hashes/sha2'
import { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'

import { MerkleTreeNode } from '../../merkleTree'
import { VALIDATOR_BONDS_PROGRAM_ID, seedFromConstants } from '../../sdk'

import type { ValidatorBonds } from '../../../idl/types/validator_bonds'
import type { MerkleTreeNodeEncoded } from '../../merkleTree'
import type { ValidatorBondsProgram } from '../../sdk'
import type { IdlAccounts } from '@coral-xyz/anchor'

// This is configuration of account SettlementClaim that was used in first version of contract (contract v1.0.0-v1.5.0).
// The SettlementClaim account was a PDA that manages the deduplication of claims.
// It was replaced by a bitmap in the SettlementClaims account in contract v2.0.0.

export type SettlementClaim = IdlAccounts<ValidatorBonds>['settlementClaim']
export const SETTLEMENT_CLAIM_SEED = seedFromConstants('SETTLEMENT_CLAIM_SEED')

export async function getSettlementClaim(
  program: ValidatorBondsProgram,
  address: PublicKey,
): Promise<SettlementClaim> {
  return program.account.settlementClaim.fetch(address)
}

export function settlementClaimAddress(
  {
    settlement,
    stakeAccountStaker,
    stakeAccountWithdrawer,
    claim,
  }: {
    settlement: PublicKey
    stakeAccountStaker: PublicKey
    stakeAccountWithdrawer: PublicKey
    claim: BN | number
  },
  validatorBondsProgramId: PublicKey = VALIDATOR_BONDS_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      SETTLEMENT_CLAIM_SEED,
      settlement.toBytes(),
      hashTreeV1(stakeAccountStaker, stakeAccountWithdrawer, claim).buffer,
    ],
    validatorBondsProgramId,
  )
}

export function hashTreeV1(
  stakeAuthority: PublicKey,
  withdrawAuthority: PublicKey,
  claim: BN | number,
): MerkleTreeNodeEncoded {
  const hasher = sha256.create()
  hasher.update(stakeAuthority.toBuffer())
  hasher.update(withdrawAuthority.toBuffer())
  hasher.update(new BN(claim).toBuffer('le', 8))
  return MerkleTreeNode.toEncodings(hasher.digest())
}
