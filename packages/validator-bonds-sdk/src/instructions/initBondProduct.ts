import { PublicKey } from '@solana/web3.js'

import { getBond } from '../api'
import {
  ProductTypes,
  getCommissionData,
  getCustomData,
  validateCommissionProductArgs,
} from '../productBond'
import {
  type InitBondProductArgs,
  type ValidatorBondsProgram,
  type ProductType,
  type CommissionProductConfig,
  bondProductAddress,
} from '../sdk'
import {
  anchorProgramWalletPubkey,
  checkAndGetBondAddress,
  toBNPreserve,
} from '../utils'

import type { ProductTypeConfig } from '../sdk'
import type { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import type { Keypair, Signer, TransactionInstruction } from '@solana/web3.js'
import type BN from 'bn.js'

export async function initCommissionProductInstruction({
  program,
  bondAccount,
  configAccount,
  voteAccount,
  authority,
  rentPayer = anchorProgramWalletPubkey(program),
  inflationBps = null,
  mevBps = null,
  blockBps = null,
  uniformBps = undefined,
}: {
  program: ValidatorBondsProgram
  bondAccount?: PublicKey
  configAccount?: PublicKey
  voteAccount?: PublicKey
  authority?: null | PublicKey | Keypair | Signer | WalletInterface // Option<signer>
  rentPayer?: PublicKey | Keypair | Signer | WalletInterface // signer
  inflationBps?: BN | number | null
  mevBps?: BN | number | null
  blockBps?: BN | number | null
  uniformBps?: BN | number | null
}): Promise<{
  instruction: TransactionInstruction
  bondProduct: PublicKey
  productType: ProductType
  configData: ProductTypeConfig
}> {
  bondAccount = checkAndGetBondAddress({
    bond: bondAccount,
    config: configAccount,
    voteAccount,
    programId: program.programId,
  })

  if (voteAccount === undefined || configAccount === undefined) {
    const bondData = await getBond(program, bondAccount)
    voteAccount = bondData.voteAccount
    configAccount = bondData.config
  }

  const renPayerPubkey =
    rentPayer instanceof PublicKey ? rentPayer : rentPayer.publicKey

  // the method cannot handle both individual and uniform being set
  if (uniformBps !== undefined && (blockBps || inflationBps || mevBps)) {
    throw new Error(
      `initCommissionProductInstruction: cannot set both uniformBps (=${String(uniformBps)}) and individual commission bps ` +
        `(block=${String(blockBps)}, inflation=${String(inflationBps)}, mev=${String(mevBps)}), bond: ${bondAccount.toBase58()}`,
    )
  } else if (uniformBps !== undefined) {
    blockBps = uniformBps
    inflationBps = uniformBps
    mevBps = uniformBps
  }

  const commissionConfig: CommissionProductConfig = {
    inflationBps: toBNPreserve(inflationBps),
    mevBps: toBNPreserve(mevBps),
    blockBps: toBNPreserve(blockBps),
  }
  validateCommissionProductArgs(commissionConfig)

  const productType: ProductType = ProductTypes.commission
  const [bondProduct] = bondProductAddress(
    bondAccount,
    productType,
    program.programId,
  )

  const configData = getCommissionData(commissionConfig)
  const args: InitBondProductArgs = {
    productType,
    configData,
  }

  if (authority !== undefined && authority !== null) {
    authority = authority instanceof PublicKey ? authority : authority.publicKey
  }

  const instruction = await program.methods
    .initBondProduct(args)
    .accountsPartial({
      config: configAccount,
      bond: bondAccount,
      voteAccount,
      bondProduct,
      authority: authority ?? null,
      rentPayer: renPayerPubkey,
    })
    .instruction()

  return {
    bondProduct,
    instruction,
    productType,
    configData,
  }
}

export async function initCustomProductInstruction({
  program,
  bondAccount,
  configAccount,
  voteAccount,
  authority,
  rentPayer = anchorProgramWalletPubkey(program),
  customName,
  customProductData,
}: {
  program: ValidatorBondsProgram
  bondAccount: PublicKey
  configAccount?: PublicKey
  voteAccount?: PublicKey
  customName: string
  customProductData: Buffer | Uint8Array | number[]
  authority?: null | PublicKey | Keypair | Signer | WalletInterface // Option<signer>
  rentPayer?: PublicKey | Keypair | Signer | WalletInterface // signer
}): Promise<{
  instruction: TransactionInstruction
  bondProduct: PublicKey
  productType: ProductType
  configData: ProductTypeConfig
}> {
  if (voteAccount === undefined || configAccount === undefined) {
    const bondData = await getBond(program, bondAccount)
    voteAccount = bondData.voteAccount
    configAccount = bondData.config
  }

  const renPayerPubkey =
    rentPayer instanceof PublicKey ? rentPayer : rentPayer.publicKey

  if (!customName || customName.length === 0) {
    throw new Error('initCustomProductInstruction: customName cannot be empty')
  }
  if (customName.length > 32) {
    throw new Error(
      'initCustomProductInstruction: customName cannot be longer than 32 characters',
    )
  }

  const productType = ProductTypes.custom(customName)
  const [bondProduct] = bondProductAddress(
    bondAccount,
    productType,
    program.programId,
  )

  const configData = getCustomData(customProductData)
  const args: InitBondProductArgs = {
    productType,
    configData,
  }

  if (authority !== undefined && authority !== null) {
    authority = authority instanceof PublicKey ? authority : authority.publicKey
  }

  const instruction = await program.methods
    .initBondProduct(args)
    .accountsPartial({
      config: configAccount,
      bond: bondAccount,
      voteAccount,
      bondProduct,
      authority: authority ?? null,
      rentPayer: renPayerPubkey,
    })
    .instruction()

  return {
    bondProduct,
    instruction,
    productType,
    configData,
  }
}
