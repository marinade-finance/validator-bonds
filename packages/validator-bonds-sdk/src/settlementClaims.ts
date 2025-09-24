import assert from 'assert'

import BN from 'bn.js'

import { SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE } from './sdk'

import type { SettlementClaims, ValidatorBondsProgram } from './sdk'
import type { AccountInfo } from '@solana/web3.js'

export type SettlementClaimsBitmap = {
  account: SettlementClaims
  bitmap: Bitmap
}

export class Bitmap {
  bitmapData: Buffer
  maxRecords: BN

  /**
   * Get data for bitmap that is restricted to the size of the bitmap defined by SettlementClaims account.
   * All other methods within the Bitmap class consider data is already restricted.
   */
  public constructor(settlementClaims: SettlementClaims, accountData: Buffer) {
    if (!Bitmap.isInitialized(settlementClaims.maxRecords, accountData)) {
      throw new Error(
        'Bitmap data is too small, SettlementClaims account is probably not fully initialized.'
      )
    }
    const expectedBitmapSize = Bitmap.bitmapByteSize(
      settlementClaims.maxRecords
    )
    this.bitmapData = accountData.subarray(
      SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE,
      SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE + expectedBitmapSize
    )
    this.maxRecords = settlementClaims.maxRecords
  }

  isSet(index: number | BN): boolean {
    this.assertValidIndex(index)
    const { byteIndex, bitIndex } = Bitmap.byteIndexBitMod(index)
    assert(bitIndex < 8)
    const bitmapData = this.bitmapData[byteIndex]
    return (
      bitmapData !== undefined && (bitmapData & (1 << (7 - bitIndex))) !== 0
    )
  }

  private static byteIndexBitMod(index: BN | number): {
    byteIndex: number
    bitIndex: number
  } {
    index = new BN(index)
    const { div, mod } = index.divmod(new BN(8))
    return { byteIndex: div.toNumber(), bitIndex: mod.toNumber() }
  }

  private static bitmapByteSize(maxRecords: BN | number): number {
    const { byteIndex, bitIndex } = Bitmap.byteIndexBitMod(maxRecords)
    return byteIndex + (bitIndex > 0 ? 1 : 0)
  }

  get bitSet(): { asString: string; counter: number } {
    const result: string[] = []
    let resultCounter = 0
    for (let i = 0; i < this.bitmapData.length; i++) {
      const bitmapData = this.bitmapData[i]
      assert(bitmapData !== undefined)
      const [outString, counter] = byte2bits(bitmapData)
      result.push(outString)
      resultCounter += counter
    }
    // working only with bitmap data restricted to number of records
    const { bitIndex } = Bitmap.byteIndexBitMod(this.maxRecords)
    if (bitIndex > 0) {
      const lastResult = result[result.length - 1]
      assert(lastResult !== undefined)
      result[result.length - 1] = lastResult.slice(0, bitIndex)
    }
    return { asString: result.join(','), counter: resultCounter }
  }

  assertValidIndex(index: BN | number) {
    index = new BN(index)
    if (index.ltn(0) || index.gte(this.maxRecords)) {
      throw new Error(`Index ${index.toString()} out of range`)
    }
  }

  static isInitialized(maxRecords: BN | number, accountData: Buffer): boolean {
    const expectedBitmapSize = Bitmap.bitmapByteSize(maxRecords)
    const availableBytes =
      accountData.length - SETTLEMENT_CLAIMS_ANCHOR_HEADER_SIZE
    return availableBytes >= expectedBitmapSize
  }
}

export function decodeSettlementClaimsData(
  program: ValidatorBondsProgram,
  accountInfo: AccountInfo<Buffer>
): SettlementClaimsBitmap {
  const account = decode(program, accountInfo)
  return {
    account,
    bitmap: new Bitmap(account, accountInfo.data),
  }
}

export function isInitialized(
  program: ValidatorBondsProgram,
  accountInfo: AccountInfo<Buffer>
): boolean {
  const account = decode(program, accountInfo)
  return Bitmap.isInitialized(account.maxRecords, accountInfo.data)
}

function decode(
  program: ValidatorBondsProgram,
  accountInfo: AccountInfo<Buffer>
): SettlementClaims {
  return program.coder.accounts.decode<SettlementClaims>(
    'settlementClaims',
    accountInfo.data
  )
}

function byte2bits(byteNum: number): [string, number] {
  let resultString = ''
  let oneCounter = 0
  for (let i = 128; i >= 1; i /= 2) {
    if (byteNum & i) {
      resultString += '1'
      oneCounter++
    } else {
      resultString += '0'
    }
  }
  return [resultString, oneCounter]
}

// function isNthBitSet(n: number, index: number) {
//   const mask: number[] = [128, 64, 32, 16, 8, 4, 2, 1]
//   return (n & mask[index]) != 0
// }
