import {
  EpochInfo,
  Keypair,
  PublicKey,
  Signer,
  TransactionInstruction,
} from '@solana/web3.js'
import { ValidatorBondsProgram, bondAddress, settlementAddress } from '../sdk'
import { anchorProgramWalletPubkey } from '../utils'
import BN from 'bn.js'
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import { getBond, getConfig } from '../api'

export async function initSettlementInstruction({
  program,
  merkleRoot,
  configAccount,
  bondAccount,
  voteAccount,
  currentEpoch,
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
  currentEpoch?: EpochInfo | number | BN | bigint
  maxTotalClaim: number | BN
  maxMerkleNodes: number | BN
  operatorAuthority?: PublicKey | Keypair | Signer | WalletInterface // signer
  rentCollector?: PublicKey
  rentPayer?: PublicKey | Keypair | Signer | WalletInterface // signer
}): Promise<{
  instruction: TransactionInstruction
  settlementAccount: PublicKey
  epoch: BN
}> {
  const renPayerPubkey =
    rentPayer instanceof PublicKey ? rentPayer : rentPayer.publicKey
  rentCollector = rentCollector || renPayerPubkey
  if (currentEpoch === undefined) {
    currentEpoch = (await program.provider.connection.getEpochInfo()).epoch
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
    currentEpoch,
    program.programId
  )

  merkleRoot = Array.isArray(merkleRoot) ? merkleRoot : Array.from(merkleRoot)
  const instruction = await program.methods
    .initSettlement({
      merkleRoot,
      maxTotalClaim: new BN(maxTotalClaim),
      maxMerkleNodes: new BN(maxMerkleNodes),
      rentCollector,
    })
    .accounts({
      config: configAccount,
      bond: bondAccount,
      settlement: settlementAccount,
      operatorAuthority: operatorAuthorityPubkey,
      rentPayer: renPayerPubkey,
    })
    .instruction()
  return {
    settlementAccount,
    instruction,
    epoch:
      typeof currentEpoch === 'object' && 'epoch' in currentEpoch
        ? new BN(currentEpoch.epoch)
        : new BN(currentEpoch.toString()),
  }
}