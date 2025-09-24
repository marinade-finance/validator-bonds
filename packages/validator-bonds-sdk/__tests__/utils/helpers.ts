import assert from 'assert'

import { checkErrorMessage } from '@marinade.finance/ts-common'
import CryptoJS from 'crypto-js'

import type { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import type { ExtendedProvider } from '@marinade.finance/web3js-1x'
import type {
  PublicKey,
  Signer,
  Transaction,
  TransactionInstruction,
  TransactionInstructionCtorFields,
} from '@solana/web3.js'

export async function executeTxWithError(
  provider: ExtendedProvider,
  info: string | undefined,
  checkMessage: string,
  signers: (WalletInterface | Signer)[],
  ...ixes: (
    | Transaction
    | TransactionInstruction
    | TransactionInstructionCtorFields
  )[]
) {
  try {
    await provider.sendIx(signers, ...ixes)
    throw new Error(
      `Expected failure '${checkMessage}', but it hasn't happened`
    )
  } catch (e) {
    info = info ? info + ' ' : ''
    if (checkErrorMessage(e, checkMessage)) {
      console.debug(`${info}expected error (check: '${checkMessage}')`, e)
    } else {
      console.error(
        `${info}wrong failure thrown, expected error: '${checkMessage}'`,
        e
      )
      throw e
    }
  }
}

export async function getRentExempt(
  provider: ExtendedProvider,
  account: PublicKey
): Promise<number> {
  const accountInfo = await provider.connection.getAccountInfo(account)
  assert(accountInfo !== null)
  return await provider.connection.getMinimumBalanceForRentExemption(
    accountInfo.data.length
  )
}

/**
 * Generate a random number in the range [min, max] using a secure random number generator.
 * The range is inclusive.
 */
export function getSecureRandomInt(min: number, max: number): number {
  const range = max - min + 1
  const bitsNeeded = Math.ceil(Math.log2(range))
  const bytesNeeded = Math.ceil(bitsNeeded / 8)
  const mask = (1 << bitsNeeded) - 1

  let result: number
  do {
    const wordArray = CryptoJS.lib.WordArray.random(bytesNeeded)
    assert(wordArray.words[0] !== undefined)
    result = wordArray.words[0] >>> 0 // Convert to unsigned 32-bit
    result = result & mask // Apply mask to get required bits
  } while (result >= range)

  return min + result
}

export function getRandomByte() {
  const wordArray = CryptoJS.lib.WordArray.random(1)
  assert(wordArray.words[0] !== undefined)
  return wordArray.words[0] & 0xff
}
