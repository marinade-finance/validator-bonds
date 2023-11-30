import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import { ValidatorBondsProgram, getProgram } from '../../src'
import { BanksTransactionMeta, startAnchor } from 'solana-bankrun'
import { BankrunProvider } from 'anchor-bankrun'
import {
  PublicKey,
  Signer,
  Transaction,
  TransactionInstruction,
  TransactionInstructionCtorFields,
} from '@solana/web3.js'
import { instanceOfWallet } from '@marinade.finance/web3js-common'
import { ExtendedProvider } from '../utils/provider'

export class BankrunExtendedProvider
  extends BankrunProvider
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
    const tx = await bankrunTransaction(this)
    tx.add(...ixes)
    await bankrunExecute(this, [this.wallet, ...signers], tx)
  }

  get walletPubkey(): PublicKey {
    return this.wallet.publicKey
  }
}

export async function initBankrunTest(programId?: PublicKey): Promise<{
  program: ValidatorBondsProgram
  provider: BankrunExtendedProvider
}> {
  const context = await startAnchor('./', [], [])
  const provider = new BankrunExtendedProvider(context)
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
  ...ixes: (
    | Transaction
    | TransactionInstruction
    | TransactionInstructionCtorFields
  )[]
): Promise<BanksTransactionMeta> {
  const tx = await bankrunTransaction(provider)
  tx.add(...ixes)
  return await bankrunExecute(provider, signers, tx)
}

export async function bankrunExecute(
  provider: BankrunProvider,
  signers: (WalletInterface | Signer)[],
  tx: Transaction
): Promise<BanksTransactionMeta> {
  for (const signer of signers) {
    if (instanceOfWallet(signer)) {
      await signer.signTransaction(tx)
    } else {
      tx.partialSign(signer)
    }
  }
  return await provider.context.banksClient.processTransaction(tx)
}

export async function assertNotExist(
  provider: BankrunProvider,
  account: PublicKey
) {
  const accountInfo = await provider.context.banksClient.getAccount(account)
  expect(accountInfo).toBeNull()
}

// https://github.com/solana-labs/solana/blob/v1.17.7/sdk/program/src/epoch_schedule.rs#L29C1-L29C45
export const MINIMUM_SLOTS_PER_EPOCH = 32
// https://github.com/solana-labs/solana/blob/v1.17.7/sdk/program/src/epoch_schedule.rs#L167
export function warpToEpoch(provider: BankrunProvider, epoch: number) {
  const epochBigInt = BigInt(epoch)
  const { slotsPerEpoch, firstNormalEpoch, firstNormalSlot } =
    provider.context.genesisConfig.epochSchedule
  let warpToEpoch: bigint
  if (epochBigInt <= firstNormalEpoch) {
    warpToEpoch = BigInt(((2 ^ epoch) - 1) * MINIMUM_SLOTS_PER_EPOCH)
  } else {
    warpToEpoch =
      (epochBigInt - firstNormalEpoch) * slotsPerEpoch + firstNormalSlot
  }
  provider.context.warpToSlot(warpToEpoch)
}
