import { PublicKey } from '@solana/web3.js'
import BN from 'bn.js'

import { getBond, getConfig } from '../api'
import { bondAddress, settlementAddress, settlementClaimsAddress } from '../sdk'
import { anchorProgramWalletPubkey } from '../utils'

import type { ValidatorBondsProgram } from '../sdk'
import type { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import type {
  EpochInfo,
  Keypair,
  Signer,
  TransactionInstruction,
} from '@solana/web3.js'

/**
 * Generate instruction to initialize settlement protected event.
 * Only operator authority is permitted to do this.
 * This uploads merkle root and sets max total claim and max merkle nodes,
 * these information is used when claim is settled.
 */
export async function initSettlementInstruction({
  program,
  merkleRoot,
  configAccount,
  bondAccount,
  voteAccount,
  epoch,
  maxTotalClaim,
  maxMerkleNodes,
  operatorAuthority,
  rentCollector,
  rentPayer = anchorProgramWalletPubkey(program),
}: {
  program: ValidatorBondsProgram
  merkleRoot: number[] | Uint8Array | Buffer
  configAccount?: PublicKey
  bondAccount?: PublicKey
  voteAccount?: PublicKey
  epoch?: EpochInfo | number | BN | bigint
  maxTotalClaim: number | BN
  maxMerkleNodes: number | BN
  operatorAuthority?: PublicKey | Keypair | Signer | WalletInterface // signer
  rentCollector?: PublicKey
  rentPayer?: PublicKey | Keypair | Signer | WalletInterface // signer
}): Promise<{
  instruction: TransactionInstruction
  settlementAccount: PublicKey
  settlementClaimsAccount: PublicKey
  epoch: BN
}> {
  const renPayerPubkey =
    rentPayer instanceof PublicKey ? rentPayer : rentPayer.publicKey
  rentCollector = rentCollector || renPayerPubkey
  if (epoch === undefined) {
    epoch = (await program.provider.connection.getEpochInfo()).epoch
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

  if (configAccount === undefined) {
    const bondData = await getBond(program, bondAccount)
    configAccount = bondData.config
  }

  if (operatorAuthority === undefined) {
    const configData = await getConfig(program, configAccount)
    operatorAuthority = configData.operatorAuthority
  }
  const operatorAuthorityPubkey =
    operatorAuthority instanceof PublicKey
      ? operatorAuthority
      : operatorAuthority.publicKey

  const [settlementAccount] = settlementAddress(
    bondAccount,
    merkleRoot,
    epoch,
    program.programId,
  )
  const [settlementClaimsAccount] = settlementClaimsAddress(
    settlementAccount,
    program.programId,
  )

  merkleRoot = Array.isArray(merkleRoot) ? merkleRoot : Array.from(merkleRoot)
  const instruction = await program.methods
    .initSettlement({
      merkleRoot,
      maxTotalClaim: new BN(maxTotalClaim),
      maxMerkleNodes: new BN(maxMerkleNodes),
      rentCollector,
      epoch: epochAsBn(epoch),
    })
    .accounts({
      config: configAccount,
      bond: bondAccount,
      settlement: settlementAccount,
      settlementClaims: settlementClaimsAccount,
      operatorAuthority: operatorAuthorityPubkey,
      rentPayer: renPayerPubkey,
    })
    .instruction()
  return {
    settlementAccount,
    settlementClaimsAccount,
    instruction,
    epoch: epochAsBn(epoch),
  }
}

function epochAsBn(epoch: EpochInfo | number | BN | bigint): BN {
  return typeof epoch === 'object' && 'epoch' in epoch
    ? new BN(epoch.epoch)
    : new BN(epoch.toString())
}
