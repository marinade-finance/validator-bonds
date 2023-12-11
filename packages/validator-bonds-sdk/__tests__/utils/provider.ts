import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import { Provider } from '@coral-xyz/anchor'
import {
  PublicKey,
  Signer,
  Transaction,
  TransactionInstruction,
  TransactionInstructionCtorFields,
} from '@solana/web3.js'

export interface ExtendedProvider extends Provider {
  sendIx(
    signers: (WalletInterface | Signer)[],
    ...ixes: (
      | Transaction
      | TransactionInstruction
      | TransactionInstructionCtorFields
    )[]
  ): Promise<void>

  get walletPubkey(): PublicKey
}
