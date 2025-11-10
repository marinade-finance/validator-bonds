import { PublicKey } from '@solana/web3.js'

import { getBondProduct } from '../api'
import {
  ProductTypes,
  getCommissionData,
  getCustomData,
  parseCommissionData,
  validateCommissionProductArgs,
} from '../productBond'
import {
  type ValidatorBondsProgram,
  type CommissionProductConfig,
} from '../sdk'
import {
  anchorProgramWalletPubkey,
  checkAndGetBondProductAddress,
  toBNPreserve,
} from '../utils'

import type {
  ConfigureBondProductArgs,
  ProductType,
  ProductTypeConfig,
} from '../sdk'
import type { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import type { Keypair, Signer, TransactionInstruction } from '@solana/web3.js'
import type BN from 'bn.js'

export async function configureCommissionProductInstruction({
  program,
  bondProductAccount,
  bondAccount,
  configAccount,
  voteAccount,
  authority = anchorProgramWalletPubkey(program),
  inflationBps,
  mevBps,
  blockBps,
  uniformBps = undefined,
}: {
  program: ValidatorBondsProgram
  bondProductAccount?: PublicKey
  bondAccount?: PublicKey
  configAccount?: PublicKey
  voteAccount?: PublicKey
  authority?: PublicKey | Keypair | Signer | WalletInterface // signer
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
  const bondProduct = checkAndGetBondProductAddress({
    bondProduct: bondProductAccount,
    config: configAccount,
    bond: bondAccount,
    voteAccount,
    productType: ProductTypes.commission,
    programId: program.programId,
  })

  const bondProductData = await getBondProduct(program, bondProduct)
  bondAccount = bondProductData.bond
  configAccount = bondProductData.config
  voteAccount = bondProductData.voteAccount

  const authorityPubkey =
    authority instanceof PublicKey ? authority : authority.publicKey

  // the method cannot handle both individual and uniform being set
  if (
    uniformBps !== undefined &&
    (blockBps !== undefined ||
      inflationBps !== undefined ||
      mevBps !== undefined)
  ) {
    throw new Error(
      `configureCommissionProductInstruction: cannot set both uniformBps (=${String(uniformBps)}) and individual commission bps ` +
        `(block=${String(blockBps)}, inflation=${String(inflationBps)}, mev=${String(mevBps)}), bond: ${bondAccount.toBase58()}`,
    )
  } else if (uniformBps !== undefined) {
    blockBps = uniformBps
    inflationBps = uniformBps
    mevBps = uniformBps
  }

  let newInflationBpsBN = toBNPreserve(inflationBps)
  let newMevBpsBN = toBNPreserve(mevBps)
  let newBlockBpsBN = toBNPreserve(blockBps)

  const onChain = parseCommissionData(bondProductData.configData)
  newInflationBpsBN =
    newInflationBpsBN !== undefined ? newInflationBpsBN : onChain.inflationBps
  newMevBpsBN = newMevBpsBN !== undefined ? newMevBpsBN : onChain.mevBps
  newBlockBpsBN = newBlockBpsBN !== undefined ? newBlockBpsBN : onChain.blockBps

  const commissionConfig: CommissionProductConfig = {
    inflationBps: newInflationBpsBN,
    mevBps: newMevBpsBN,
    blockBps: newBlockBpsBN,
  }
  validateCommissionProductArgs(commissionConfig)

  const configData = getCommissionData(commissionConfig)
  const args: ConfigureBondProductArgs = {
    configData,
  }

  const instruction = await program.methods
    .configureBondProduct(args)
    .accountsPartial({
      bondProduct,
      config: configAccount,
      bond: bondAccount,
      voteAccount,
      authority: authorityPubkey,
    })
    .instruction()

  return {
    bondProduct,
    instruction,
    productType: ProductTypes.commission,
    configData,
  }
}

export async function configureCustomProductInstruction({
  program,
  bondProductAccount,
  bondAccount,
  configAccount,
  voteAccount,
  authority = anchorProgramWalletPubkey(program),
  customName,
  customProductData,
}: {
  program: ValidatorBondsProgram
  bondProductAccount?: PublicKey
  bondAccount?: PublicKey
  configAccount?: PublicKey
  voteAccount?: PublicKey
  authority?: PublicKey | Keypair | Signer | WalletInterface // signer
  customName?: string
  customProductData: Buffer | Uint8Array | number[]
}): Promise<{
  instruction: TransactionInstruction
  bondProduct: PublicKey
  productType: ProductType
  configData: ProductTypeConfig
}> {
  const bondProduct = checkAndGetBondProductAddress({
    bondProduct: bondProductAccount,
    config: configAccount,
    bond: bondAccount,
    voteAccount,
    productType: customName ? ProductTypes.custom(customName) : undefined,
    programId: program.programId,
  })

  const bondProductData = await getBondProduct(program, bondProduct)
  bondAccount = bondProductData.bond
  configAccount = bondProductData.config
  voteAccount = bondProductData.voteAccount
  const customProductType = bondProductData.productType

  const authorityPubkey =
    authority instanceof PublicKey ? authority : authority.publicKey

  const configData = getCustomData(customProductData)
  const args: ConfigureBondProductArgs = {
    configData,
  }

  const instruction = await program.methods
    .configureBondProduct(args)
    .accountsPartial({
      bondProduct,
      config: configAccount,
      bond: bondAccount,
      voteAccount,
      authority: authorityPubkey,
    })
    .instruction()

  return {
    bondProduct,
    instruction,
    productType: customProductType,
    configData,
  }
}
