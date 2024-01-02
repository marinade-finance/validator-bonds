import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import { ExtendedProvider } from './provider'
import {
  Keypair,
  PublicKey,
  Signer,
  Transaction,
  TransactionInstruction,
  TransactionInstructionCtorFields,
} from '@solana/web3.js'
import { Errors } from '../../src'
import { ExecutionError } from '@marinade.finance/web3js-common'

type ToString = { toString(): string }

export function checkErrorMessage(e: unknown, message: ToString): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'message' in e &&
    typeof e.message === 'string' &&
    e.message.includes(message.toString())
  )
}

export function checkAnchorErrorMessage(
  e: unknown,
  errorNumber: ToString | number,
  errorMessage: string
) {
  let decimalNumber: number
  if (errorNumber.toString().startsWith('0x')) {
    decimalNumber = parseInt(errorNumber.toString(), 16)
  } else {
    decimalNumber = parseInt(errorNumber.toString())
  }
  const hexNumber = '0x' + decimalNumber.toString(16)

  let passed = false
  let eToCheck = e
  while (eToCheck !== null && !passed) {
    passed =
      checkErrorMessage(eToCheck, errorNumber) ||
      checkErrorMessage(eToCheck, hexNumber)
    if (eToCheck instanceof ExecutionError && eToCheck.cause !== null) {
      eToCheck = eToCheck.cause
    } else {
      eToCheck = null
    }
  }
  if (!passed) {
    throw new Error(
      `Expected anchor error number ${errorNumber} within error ` +
        `${(e as ToString).toString()}`
    )
  }

  if (!Errors.get(decimalNumber)?.includes(errorMessage)) {
    throw new Error(
      `Expected anchor error message '${errorMessage}' within error anchor error number ` +
        `${errorNumber}/'${Errors.get(decimalNumber)}'`
    )
  }
}

export async function verifyErrorMessage(
  provider: ExtendedProvider,
  info: string,
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
    throw new Error(`Expected failure ${info}, but it hasn't happened`)
  } catch (e) {
    if (checkErrorMessage(e, checkMessage)) {
      console.debug(`${info} expected error (check: '${checkMessage}')`, e)
    } else {
      console.error(
        `${info} wrong failure thrown, expected error: '${checkMessage}'`,
        e
      )
      throw e
    }
  }
}

export function isSinger(
  key: PublicKey | Signer | Keypair | WalletInterface | undefined
): key is Signer | Keypair | WalletInterface {
  return (
    key !== undefined &&
    'publicKey' in key &&
    ('secretKey' in key || 'signTransaction' in key)
  )
}

export function signer(
  key: PublicKey | Signer | Keypair | WalletInterface | undefined
): Signer | Keypair | WalletInterface {
  if (isSinger(key)) {
    return key
  } else {
    throw new Error(
      `Expected signer but it's not: ${
        key === undefined ? undefined : key.toBase58()
      }`
    )
  }
}

export function pubkey(
  key: PublicKey | Signer | Keypair | WalletInterface | undefined
): PublicKey {
  if (key === undefined) {
    throw new Error("Expected pubkey or signer but it's undefined")
  }
  return isSinger(key) ? key.publicKey : key
}

export function signerWithPubkey(
  key: PublicKey | Signer | Keypair | undefined
): [Signer | Keypair, PublicKey] {
  if (key === undefined) {
    throw new Error("Expected pubkey or signer but it's undefined")
  }
  if (!isSinger(key)) {
    throw new Error(`Expected signer but it's not: ${key.toBase58()}`)
  }
  return [key, key.publicKey]
}

export const sleep = async (ms: number) => {
  return new Promise(resolve => setTimeout(resolve, ms))
}
