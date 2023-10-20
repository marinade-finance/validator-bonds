import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import { ValidatorBondsProgram, getProgram } from '../../../src'
import { startAnchor } from 'solana-bankrun'
import { BankrunProvider } from 'anchor-bankrun'
import { PublicKey, Signer, Transaction } from '@solana/web3.js'
import { instanceOfWallet } from '@marinade.finance/web3js-common'

export async function initBankrunTest(programId?: PublicKey): Promise<{
  program: ValidatorBondsProgram
  provider: BankrunProvider
}> {
  const context = await startAnchor('./', [], [])
  const provider = new BankrunProvider(context)
  console.dir(provider.context.banksClient)
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
    feePayer: provider.publicKey,
    blockhash: provider.context.lastBlockhash,
    lastValidBlockHeight,
  })
}

export async function bankrunExecute(
  provider: BankrunProvider,
  tx: Transaction,
  signers: (WalletInterface | Signer)[]
) {
  for (const signer of signers) {
    if (instanceOfWallet(signer)) {
      await signer.signTransaction(tx)
    } else {
      tx.partialSign(signer)
    }
  }
  await provider.context.banksClient.processTransaction(tx)
}
