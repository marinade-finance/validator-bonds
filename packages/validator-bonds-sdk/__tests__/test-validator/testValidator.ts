import * as anchor from '@coral-xyz/anchor'
import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import { AnchorProvider } from '@coral-xyz/anchor'
import { ValidatorBondsProgram, getProgram } from '../../src'
import { ExtendedProvider } from '../utils/provider'
import {
  PublicKey,
  Signer,
  Transaction,
  TransactionInstruction,
  TransactionInstructionCtorFields,
} from '@solana/web3.js'
import { transaction } from '@marinade.finance/anchor-common'
import { executeTxSimple } from '@marinade.finance/web3js-common'

export class AnchorExtendedProvider
  extends AnchorProvider
  implements ExtendedProvider
{
  async sendIx(
    signers: (WalletInterface | Signer)[],
    ...ixes: (
      | Transaction
      | TransactionInstruction
      | TransactionInstructionCtorFields
    )[]
  ): Promise<void> {
    const tx = await transaction(this)
    tx.add(...ixes)
    await executeTxSimple(this.connection, tx, [this.wallet, ...signers])
  }

  get walletPubkey(): PublicKey {
    return this.wallet.publicKey
  }
}

export async function initTest(): Promise<{
  program: ValidatorBondsProgram
  provider: AnchorExtendedProvider
}> {
  const anchorProvider = AnchorExtendedProvider.env()
  const provider = new AnchorExtendedProvider(
    anchorProvider.connection,
    anchorProvider.wallet,
    { ...anchorProvider.opts, skipPreflight: true }
  )
  anchor.setProvider(provider)
  return { program: getProgram(provider), provider }
}
