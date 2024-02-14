import { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider'
import {
  ValidatorBondsProgram,
  checkAndGetBondAddress,
  getProgram,
} from '../../src'
import { BanksTransactionMeta, startAnchor } from 'solana-bankrun'
import { BankrunProvider } from 'anchor-bankrun'
import {
  Keypair,
  PublicKey,
  Signer,
  Transaction,
  TransactionInstruction,
  TransactionInstructionCtorFields,
} from '@solana/web3.js'
import { instanceOfWallet } from '@marinade.finance/web3js-common'
import { ExtendedProvider } from '../utils/provider'
import { delegatedStakeAccount } from '../utils/staking'
import { executeFundBondInstruction } from '../utils/testTransactions'

export class BankrunExtendedProvider
  extends BankrunProvider
  implements ExtendedProvider
{
  async sendIx(
    signers: (WalletInterface | Signer | Keypair)[],
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
  signers: (WalletInterface | Signer | Keypair)[],
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
  signers: (WalletInterface | Signer | Keypair)[],
  tx: Transaction
): Promise<BanksTransactionMeta> {
  for (const signer of signers) {
    if (instanceOfWallet(signer)) {
      await signer.signTransaction(tx)
    } else if (signer instanceof Keypair || 'secretKey' in signer) {
      tx.partialSign(signer)
    } else {
      throw new Error(
        'bankrunExecute: provided signer parameter is not a signer: ' + signer
      )
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
  let warpToSlot: bigint
  if (epochBigInt <= firstNormalEpoch) {
    warpToSlot = BigInt((2 ** epoch - 1) * MINIMUM_SLOTS_PER_EPOCH)
  } else {
    warpToSlot =
      (epochBigInt - firstNormalEpoch) * slotsPerEpoch + firstNormalSlot
  }
  provider.context.warpToSlot(warpToSlot)
}

export async function warpToNextEpoch(provider: BankrunProvider) {
  await warpOffsetEpoch(provider, 1)
}

export async function warpOffsetEpoch(
  provider: BankrunProvider,
  plusEpochs: number
) {
  const nextEpoch = (await currentEpoch(provider)) + plusEpochs
  warpToEpoch(provider, nextEpoch)
}

export async function currentEpoch(provider: BankrunProvider): Promise<number> {
  return Number((await provider.context.banksClient.getClock()).epoch)
}

// this cannot be in generic testTransactions.ts because of warping requires BankrunProvider
export async function delegateAndFund({
  program,
  provider,
  lamports,
  voteAccount,
  bond,
  config,
}: {
  program: ValidatorBondsProgram
  provider: BankrunExtendedProvider
  lamports: number
  voteAccount: PublicKey
  bond?: PublicKey
  config?: PublicKey
}): Promise<{ stakeAccount: PublicKey }> {
  const { stakeAccount, withdrawer: stakeAccountWithdrawer } =
    await delegatedStakeAccount({
      provider,
      lamports,
      voteAccountToDelegate: voteAccount,
    })
  bond = checkAndGetBondAddress(bond, config, voteAccount, program.programId)
  await warpToNextEpoch(provider) // activating stake account
  await executeFundBondInstruction({
    program,
    provider,
    bondAccount: bond,
    stakeAccount,
    stakeAccountAuthority: stakeAccountWithdrawer,
  })
  return { stakeAccount }
}
