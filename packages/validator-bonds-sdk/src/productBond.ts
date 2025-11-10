import { BorshCoder } from '@coral-xyz/anchor'
import { jsonStringify } from '@marinade.finance/ts-common'

import { MAX_BPS } from './api'
import { ValidatorBondsIDL } from './sdk'
import { toBNPreserve } from './utils'

import type { ProductType } from './sdk'
import type {
  CommissionProductConfig,
  ProductTypeConfig,
  ValidatorBonds,
} from './sdk'

export class ProductTypes {
  static get commission(): ProductType {
    return { commission: {} }
  }

  static custom(name: string): ProductType {
    return { custom: [name] } // Note: array/tuple format
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static rustEnumType(productType: ProductType): any {
    if ('commission' in productType) {
      return { Commission: {} }
    } else if ('custom' in productType) {
      return {
        Custom: [productType.custom[0]],
      }
    } else {
      throw new Error(
        `Unknown bond product type: ${jsonStringify(productType)}`,
      )
    }
  }

  static discriminant(productType: ProductType): Buffer {
    const coder = new BorshCoder(ValidatorBondsIDL as ValidatorBonds)
    return coder.types.encode('ProductType', this.rustEnumType(productType))
  }
}

export function getProductTypeName(productType: ProductType): string {
  if ('commission' in productType) {
    return 'commission'
  } else if ('custom' in productType) {
    return `${productType.custom[0]}`
  }
  throw new Error(`Unknown bond product type: ${jsonStringify(productType)}`)
}

export function getProductTypeNameSeed(productType: ProductType): Buffer {
  return Buffer.from(getProductTypeName(productType))
}

export function getCommissionData(
  data: CommissionProductConfig,
): ProductTypeConfig {
  return { commission: [data] }
}

export function getCommissionNumberData(data: {
  blockBps: number | null
  inflationBps: number | null
  mevBps: number | null
}): ProductTypeConfig {
  return {
    commission: [
      {
        blockBps: toBNPreserve(data.blockBps),
        inflationBps: toBNPreserve(data.inflationBps),
        mevBps: toBNPreserve(data.mevBps),
      },
    ],
  }
}

export function parseCommissionData(
  configData: ProductTypeConfig,
): CommissionProductConfig {
  if (configData.commission) {
    return configData.commission[0]
  }
  throw new Error(
    `parseCommissionData: Expected commission bond product data, got: ${jsonStringify(
      configData,
    )}`,
  )
}

export function getCustomProductName(productType: ProductType): string {
  if (productType.custom) {
    return productType.custom[0]
  }
  throw new Error(
    `getCustomProductName: Expected custom bond product type, got: ${jsonStringify(
      productType,
    )}`,
  )
}

export function getCustomData(
  data: Buffer | Uint8Array | number[],
): ProductTypeConfig {
  return {
    custom: [Buffer.from(data)],
  }
}

export function parseCustomData(configData: ProductTypeConfig): Buffer {
  if (configData.custom) {
    return Buffer.from(configData.custom[0])
  }
  throw new Error(
    `parseCustomData: Expected custom bond product data, got: ${jsonStringify(
      configData,
    )}`,
  )
}

export function validateCommissionProductArgs(
  data: CommissionProductConfig,
): void {
  if (data.inflationBps && data.inflationBps.gt(MAX_BPS)) {
    throw new Error(
      `validateCommissionData: inflationBps cannot be greater than ${MAX_BPS.toString()}, got: ${data.inflationBps.toString()}`,
    )
  }
  if (data.mevBps && data.mevBps.gt(MAX_BPS)) {
    throw new Error(
      `validateCommissionData: mevBps cannot be greater than ${MAX_BPS.toString()}, got: ${data.mevBps.toString()}`,
    )
  }
  if (data.blockBps && data.blockBps.gt(MAX_BPS)) {
    throw new Error(
      `validateCommissionData: blockBps cannot be greater than ${MAX_BPS.toString()}, got: ${data.blockBps.toString()}`,
    )
  }
}
