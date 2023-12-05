import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import { ValidatorBondsProgram, getProgram } from '../../../src'
import { BanksTransactionMeta, startAnchor } from 'solana-bankrun'
import { BankrunProvider } from 'anchor-bankrun'
import {
  PublicKey,
  SerializeConfig,
  Signer,
  Transaction,
  TransactionInstruction,
  TransactionInstructionCtorFields,
} from '@solana/web3.js'
import { instanceOfWallet } from '@marinade.finance/web3js-common'

export async function initBankrunTest(programId?: PublicKey): Promise<{
  program: ValidatorBondsProgram
  provider: BankrunProvider
}> {
  const context = await startAnchor('./', [], [])
  const provider = new BankrunProvider(context)
  return {
    program: getProgram({ connection: provider, programId }),
    provider,
  }
}

export async function bankrunTransaction(
  provider: BankrunProvider
): Promise<Transaction> {
  const bh = await provider.context.banksClient.getLatestBlockhash()
  const lastValidBlockHeight = (
    bh === null ? Number.MAX_VALUE : bh[1]
  ) as number
  return new Transaction({
    feePayer: provider.wallet.publicKey,
    blockhash: provider.context.lastBlockhash,
    lastValidBlockHeight,
  })
}

export async function bankrunExecuteIx(
  provider: BankrunProvider,
  signers: (WalletInterface | Signer)[],
  ixes: (
    | Transaction
    | TransactionInstruction
    | TransactionInstructionCtorFields
  )[],
  serializeConfig?: SerializeConfig
): Promise<BanksTransactionMeta> {
  const tx = await bankrunTransaction(provider)
  tx.add(...ixes)
  return await bankrunExecute(provider, signers, tx, serializeConfig)
}

export async function bankrunExecute(
  provider: BankrunProvider,
  signers: (WalletInterface | Signer)[],
  tx: Transaction,
  serializeConfig?: SerializeConfig
): Promise<BanksTransactionMeta> {
  for (const signer of signers) {
    if (instanceOfWallet(signer)) {
      await signer.signTransaction(tx)
    } else {
      tx.partialSign(signer)
    }
  }
  return await provider.context.banksClient.processTransaction(
    tx,
    serializeConfig
  )
}
