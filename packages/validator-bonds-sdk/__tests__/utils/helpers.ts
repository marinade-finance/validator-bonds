import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import { ExtendedProvider } from './provider'
import {
  Signer,
  Transaction,
  TransactionInstruction,
  TransactionInstructionCtorFields,
} from '@solana/web3.js'

export function checkErrorMessage(e: unknown, message: string): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'message' in e &&
    typeof e.message === 'string' &&
    e.message.includes(message)
  )
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
