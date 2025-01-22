import { PublicKey } from '@solana/web3.js'
import {
  MerkleTreeNode,
  MerkleTreeNodeEncoded,
  pubkeyToWordArray,
} from '../../merkleTree'
import {
  VALIDATOR_BONDS_PROGRAM_ID,
  ValidatorBondsProgram,
  seedFromConstants,
} from '../../sdk'
import { ValidatorBonds } from '../../../generated/validator_bonds'
import { IdlAccounts } from '@coral-xyz/anchor'
import BN from 'bn.js'
import CryptoJS from 'crypto-js'

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
  const sha256 = CryptoJS.algo.SHA256.create()
  sha256.update(pubkeyToWordArray(stakeAuthority))
  sha256.update(pubkeyToWordArray(withdrawAuthority))
  claim = new BN(claim)
  sha256.update(CryptoJS.enc.Hex.parse(claim.toBuffer('le', 8).toString('hex')))
  const wordArray = sha256.finalize()
  return MerkleTreeNode.toEncodings(wordArray)
}
