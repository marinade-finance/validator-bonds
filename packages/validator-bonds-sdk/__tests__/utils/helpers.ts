import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import { ExtendedProvider } from '@marinade.finance/web3js-common'
import {
  PublicKey,
  Signer,
  Transaction,
  TransactionInstruction,
  TransactionInstructionCtorFields,
} from '@solana/web3.js'
import { checkErrorMessage } from '@marinade.finance/ts-common'
import assert from 'assert'

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
