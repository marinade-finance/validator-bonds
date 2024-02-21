import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import { Provider } from '@coral-xyz/anchor'
import {
  Keypair,
  PublicKey,
  Signer,
  Transaction,
  TransactionInstruction,
  TransactionInstructionCtorFields,
} from '@solana/web3.js'

export type SignerType = Keypair | Signer | WalletInterface

export interface ExtendedProvider extends Provider {
  sendIx(
    signers: SignerType[],
    ...ixes: (
      | Transaction
      | TransactionInstruction
      | TransactionInstructionCtorFields
    )[]
  ): Promise<void>

  get walletPubkey(): PublicKey
}
