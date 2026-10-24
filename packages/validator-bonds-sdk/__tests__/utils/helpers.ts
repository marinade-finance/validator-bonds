import assert from 'assert'
import { randomBytes, randomInt } from 'crypto'

import { checkErrorMessage } from '@marinade.finance/ts-common'

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
    Transaction | TransactionInstruction | TransactionInstructionCtorFields
  )[]
) {
  try {
    await provider.sendIx(signers, ...ixes)
    throw new Error(
      `Expected failure '${checkMessage}', but it hasn't happened`,
    )
  } catch (e) {
    info = info ? info + ' ' : ''
    if (checkErrorMessage(e, checkMessage)) {
      console.debug(`${info}expected error (check: '${checkMessage}')`, e)
    } else {
      console.error(
        `${info}wrong failure thrown, expected error: '${checkMessage}'`,
        e,
      )
      throw e
    }
  }
}

export async function getRentExempt(
  provider: ExtendedProvider,
  account: PublicKey,
): Promise<number> {
  const accountInfo = await provider.connection.getAccountInfo(account)
  assert(accountInfo !== null)
  return await provider.connection.getMinimumBalanceForRentExemption(
    accountInfo.data.length,
  )
}

/**
 * Generate a random number in the range [min, max] using a secure random number generator.
 * The range is inclusive.
 */
export function getSecureRandomInt(min: number, max: number): number {
  return randomInt(min, max + 1)
}

export function getRandomByte() {
  return randomBytes(1)[0] as number
}

export function customTestResult(name: string) {
  return { custom: { '0': name } }
}
