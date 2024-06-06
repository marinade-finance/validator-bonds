import { PublicKey, TransactionInstruction } from '@solana/web3.js'
import {
  ValidatorBondsProgram,
  bondsWithdrawerAuthority,
  ValidatorBonds,
  VALIDATOR_BONDS_PROGRAM_ID,
  seedFromConstants,
} from '../../sdk'
import { IdlAccounts } from '@coral-xyz/anchor'
import {
  MerkleTreeNode,
  MerkleTreeNodeEncoded,
  pubkeyToWordArray,
} from '../../merkleTree'
import BN from 'bn.js'

/**
 * Generate instruction to close settlement claim V1.
 * The new version of processing does not use PDA for deduplication of claiming
 * but it uses Bitmap saved in 'SettlementClaims' account.
 */
export async function closeSettlementClaimInstruction({
  program,
  settlementAccount,
  settlementClaimAccount,
  rentCollector,
  configAccount,
  withdrawer,
  claimAmount,
}: {
  program: ValidatorBondsProgram
  settlementAccount: PublicKey
  settlementClaimAccount?: PublicKey
  rentCollector?: PublicKey
  configAccount?: PublicKey
  voteAccount?: PublicKey
  withdrawer?: PublicKey
  claimAmount?: number
}): Promise<{
  instruction: TransactionInstruction
}> {
  if (
    settlementClaimAccount === undefined &&
    configAccount &&
    withdrawer &&
    claimAmount
  ) {
    const [bondsWithdrawerAuth] = bondsWithdrawerAuthority(
      configAccount,
      program.programId
    )
    settlementClaimAccount = settlementClaimAddress(
      {
        settlement: settlementAccount,
        stakeAccountStaker: bondsWithdrawerAuth,
        stakeAccountWithdrawer: withdrawer,
        claim: claimAmount,
      },
      program.programId
    )[0]
  }

  if (!settlementClaimAccount) {
    throw new Error(
      'settlementClaimAccount is required, provide address or parameters to derive it'
    )
  }

  if (!rentCollector) {
    const settlementClaimData = await getSettlementClaim(
      program,
      settlementClaimAccount
    )
    rentCollector = settlementClaimData.rentCollector
  }

  const instruction = await program.methods
    .closeSettlementClaimV1()
    .accounts({
      settlement: settlementAccount,
      settlementClaim: settlementClaimAccount,
      rentCollector,
    })
    .instruction()
  return {
    instruction,
  }
}

export type SettlementClaim = IdlAccounts<ValidatorBonds>['settlementClaim']
export const SETTLEMENT_CLAIM_SEED = seedFromConstants('SETTLEMENT_CLAIM_SEED')

async function getSettlementClaim(
  program: ValidatorBondsProgram,
  address: PublicKey
): Promise<SettlementClaim> {
  return program.account.settlementClaim.fetch(address)
}

function settlementClaimAddress(
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
  validatorBondsProgramId: PublicKey = VALIDATOR_BONDS_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      SETTLEMENT_CLAIM_SEED,
      settlement.toBytes(),
      hashTreeV1(stakeAccountStaker, stakeAccountWithdrawer, claim).buffer,
    ],
    validatorBondsProgramId
  )
}

function hashTreeV1(
  stakeAuthority: PublicKey,
  withdrawAuthority: PublicKey,
  claim: BN | number
): MerkleTreeNodeEncoded {
  const sha256 = CryptoJS.algo.SHA256.create()
  sha256.update(pubkeyToWordArray(stakeAuthority))
  sha256.update(pubkeyToWordArray(withdrawAuthority))
  claim = new BN(claim)
  sha256.update(CryptoJS.enc.Hex.parse(claim.toBuffer('le', 8).toString('hex')))
  const wordArray = sha256.finalize()
  return MerkleTreeNode.toEncodings(wordArray)
}
